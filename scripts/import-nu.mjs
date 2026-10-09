import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { load } from "cheerio"
import sharp from "sharp"
import TurndownService from "turndown"
import turndownPluginGfm from "turndown-plugin-gfm"
import YAML from "yaml"

const ROOT = process.cwd()
const CONTENT_DIR = path.join(ROOT, "content")
const MEDIA_DIR = path.join(CONTENT_DIR, "media", "nu")
const INVENTORY_PATH = path.join(ROOT, "data", "nu-publications.json")
const REPORT_PATH = path.join(ROOT, "data", "nu-import-report.json")
const CACHE_DIR = process.env.NU_CACHE_DIR
const SITE_ROOT = "https://www.nu.nl"
const CONCURRENCY = 5
const IMAGE_WIDTH = 1200
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const FORCE = process.argv.includes("--force")
const DRY_RUN = process.argv.includes("--dry-run")
const SKIP_IMAGES = process.argv.includes("--no-images")
const limitArgument = process.argv.find((argument) => argument.startsWith("--limit="))
const LIMIT = limitArgument ? Number(limitArgument.split("=")[1]) : undefined

const HEADERS = {
  "user-agent": "Googlebot",
  "accept-language": "nl-NL,nl;q=0.9,en;q=0.8",
}

const report = {
  generatedAt: new Date().toISOString(),
  discovered: 0,
  selected: 0,
  excludedAsNews: 0,
  excludedMonthlyOverview: 0,
  excludedOtherAuthor: 0,
  imported: 0,
  existing: 0,
  moved: 0,
  updatedMetadata: 0,
  failures: [],
  images: { downloaded: 0, reused: 0, skipped: [] },
  files: [],
}

const { gfm } = turndownPluginGfm
const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "_",
  strongDelimiter: "**",
})
turndown.use(gfm)

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/g, " en ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function cleanText(value = "") {
  return load(`<body>${value}</body>`)("body")
    .text()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function canonicalUrl(value) {
  try {
    const url = new URL(value, SITE_ROOT)
    url.protocol = "https:"
    url.hostname = "www.nu.nl"
    url.hash = ""
    url.search = ""
    return url.href.replace(/\/$/, "")
  } catch {
    return value
  }
}

function nuId(value) {
  return canonicalUrl(value)?.match(/\/(\d{7})\//)?.[1]
}

function isoDate(value) {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString().slice(0, 10)
}

function yamlFrontmatter(data) {
  const clean = Object.fromEntries(
    Object.entries(data).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  )
  return `---\n${YAML.stringify(clean, { lineWidth: 0 }).trim()}\n---`
}

function parseMarkdown(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { data: {}, body: markdown }
  return { data: YAML.parse(match[1]) || {}, body: markdown.slice(match[0].length).trim() }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

async function listMarkdown(directory = CONTENT_DIR) {
  const files = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await listMarkdown(filename)))
    else if (entry.name.endsWith(".md")) files.push(filename)
  }
  return files
}

async function existingInventory() {
  const records = []
  for (const filename of await listMarkdown()) {
    const markdown = await fs.readFile(filename, "utf8")
    const { data, body } = parseMarkdown(markdown)
    const ids = new Set()
    if (String(data.source || "").toLowerCase() === "nu.nl") {
      const id = nuId(data.sourceUrl)
      if (id) ids.add(id)
    }
    const sourceNote = body.match(
      /> \[!NOTE\][\s\S]{0,260}?\(https?:\/\/(?:www\.)?nu\.nl\/[^)]+\)/i,
    )?.[0]
    if (sourceNote) {
      const id = nuId(sourceNote.match(/https?:\/\/[^)]+/)?.[0])
      if (id) ids.add(id)
    }
    records.push({
      filename,
      relativePath: path.relative(CONTENT_DIR, filename).split(path.sep).join("/"),
      data,
      body,
      ids,
    })
  }
  return records
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function fetchResponse(url, attempts = 4) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: HEADERS, redirect: "follow" })
      if (response.ok) return response
      lastError = new Error(`${response.status} ${response.statusText} for ${url}`)
      if (response.status < 500 && response.status !== 429) break
    } catch (error) {
      lastError = error
    }
    await sleep(400 * attempt)
  }
  throw lastError
}

async function fetchArticleHtml(item) {
  if (CACHE_DIR && item.id) {
    try {
      return await fs.readFile(path.join(CACHE_DIR, `${item.id}.html`), "utf8")
    } catch {
      // Fetch and optionally populate the cache below.
    }
  }
  const html = await (await fetchResponse(item.url)).text()
  if (CACHE_DIR && item.id) {
    await fs.mkdir(CACHE_DIR, { recursive: true })
    await fs.writeFile(path.join(CACHE_DIR, `${item.id}.html`), html)
  }
  return html
}

async function mapConcurrent(values, concurrency, callback) {
  let cursor = 0
  const results = new Array(values.length)
  async function worker() {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= values.length) return
      results[index] = await callback(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker))
  return results
}

function initialState(html) {
  const match = html.match(/window\.__INITIAL_STATE__="([^"]+)"/)
  if (!match) throw new Error("NU.nl initial state ontbreekt")
  return JSON.parse(decodeURIComponent(match[1]))
}

function schemaArticle($) {
  let article
  $('script[type="application/ld+json"]').each((_index, element) => {
    try {
      const value = JSON.parse($(element).text())
      const entries = value["@graph"] || [value]
      article ||= entries.find((entry) => entry.articleBody)
    } catch {
      // Ignore unrelated or malformed structured data.
    }
  })
  return article
}

function findByline(value) {
  if (!value || typeof value !== "object") return undefined
  if (value.webContainerFlavor?.cssClass === "byline" && Array.isArray(value.blocks)) {
    const text = value.blocks
      .flatMap((block) => block.styledTexts || [])
      .map((styledText) => styledText.text)
      .filter(Boolean)
      .join(" ")
    if (text) return text
  }
  for (const child of Object.values(value)) {
    const byline = findByline(child)
    if (byline) return byline
  }
}

function articleMeta(html, item) {
  const $ = load(html)
  const state = initialState(html)
  const schema = schemaArticle($)
  if (!schema?.articleBody) throw new Error("NU.nl articleBody ontbreekt")
  const byline = findByline(state.content.blocksMain)
  if (!/^Door (?:NU\.nl\/)?Bastiaan Vroegop$/i.test(byline || "")) {
    throw new Error(`onverwachte NU.nl-auteur: ${byline || "onbekend"}`)
  }
  return {
    $,
    state,
    schema,
    byline,
    sourceUrl: canonicalUrl(schema.url || item.url),
    title: cleanText(schema.headline || item.title),
    description: cleanText($('meta[name="description"]').attr("content")),
    published: isoDate(schema.datePublished),
    modified: isoDate(schema.dateModified),
    sections: schema.articleSection || item.sections || [],
    wordCount: Number(schema.wordCount || item.wordCount || 0),
  }
}

async function downloadImage(urlValue, slug) {
  if (SKIP_IMAGES || !urlValue) return undefined
  let url
  try {
    url = new URL(urlValue, SITE_ROOT).href
  } catch {
    report.images.skipped.push({ url: urlValue, reason: "ongeldige URL" })
    return undefined
  }

  const hash = createHash("sha1").update(url).digest("hex").slice(0, 12)
  const destinationDir = path.join(MEDIA_DIR, slug)
  if (!DRY_RUN) await fs.mkdir(destinationDir, { recursive: true })
  try {
    const cached = (await fs.readdir(destinationDir)).find((name) => name.startsWith(`${hash}.`))
    if (cached) {
      report.images.reused += 1
      return path.posix.join("media", "nu", slug, cached)
    }
  } catch {
    // The directory is created after a successful download in dry-run-free runs.
  }

  let response
  try {
    response = await fetchResponse(url, 3)
  } catch (error) {
    report.images.skipped.push({ url, reason: error.message })
    return undefined
  }
  const contentType = response.headers.get("content-type") || ""
  if (!contentType.startsWith("image/")) {
    report.images.skipped.push({ url, reason: `geen afbeelding (${contentType || "onbekend"})` })
    return undefined
  }
  const declaredLength = Number(response.headers.get("content-length") || 0)
  if (declaredLength > MAX_IMAGE_BYTES) {
    report.images.skipped.push({ url, reason: `groter dan ${MAX_IMAGE_BYTES} bytes` })
    return undefined
  }
  const input = Buffer.from(await response.arrayBuffer())
  if (input.length > MAX_IMAGE_BYTES) {
    report.images.skipped.push({ url, reason: `groter dan ${MAX_IMAGE_BYTES} bytes` })
    return undefined
  }

  const isGif = contentType.startsWith("image/gif")
  const isSvg = contentType.startsWith("image/svg+xml")
  const extension = isGif ? ".gif" : isSvg ? ".svg" : ".webp"
  const filename = `${hash}${extension}`
  if (!DRY_RUN) {
    const destination = path.join(destinationDir, filename)
    if (isGif || isSvg) {
      await fs.writeFile(destination, input)
    } else {
      await sharp(input)
        .rotate()
        .resize({ width: IMAGE_WIDTH, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(destination)
    }
  }
  report.images.downloaded += 1
  return path.posix.join("media", "nu", slug, filename)
}

function articleRoot(state) {
  return state.content.blocksMain.find(
    (block) => block.__typename === "ContainerBlock" && Array.isArray(block.blocks),
  )
}

function imageData(value) {
  const image = value?.image || value
  if (!image?.url) return undefined
  return {
    url: image.url,
    alt: cleanText(image.description || image.title || "Afbeelding bij het artikel"),
    caption: unique([
      cleanText(image.title),
      image.copyright ? `Beeld: ${cleanText(image.copyright)}` : undefined,
    ]).join(" — "),
  }
}

function articleEvents(meta) {
  const root = articleRoot(meta.state)
  if (!root) throw new Error("NU.nl artikelcontainer ontbreekt")
  const events = []
  const primaryImage = canonicalUrl(meta.schema.primaryImageOfPage)

  function walk(block) {
    if (!block || typeof block !== "object") return
    if (block.webContainerFlavor?.cssClass === "byline") return
    if (block.__typename === "TextBlock") {
      const html = (block.styledTexts || []).map((part) => part.text || "").join("")
      if (/^directives:\s*\[\s*\]$/i.test(cleanText(html))) return
      if (block.textRole === "ARTICLE_BODY" && cleanText(html)) {
        events.push({ type: "html", html })
      } else if (block.textRole === "ARTICLE_SUBHEADER" && cleanText(html)) {
        events.push({ type: "heading", text: cleanText(html) })
      }
      return
    }
    if (block.__typename === "ImageBlock") {
      const image = imageData(block)
      if (image && canonicalUrl(image.url) !== primaryImage) events.push({ type: "image", image })
      return
    }
    if (block.__typename === "CarouselLinkBlock") {
      for (const link of block.links || []) {
        const image = imageData(link.linkFlavor)
        if (image) events.push({ type: "image", image })
      }
      return
    }
    if (block.__typename === "JwPlayerVideoBlock" && block.mediaId) {
      events.push({
        type: "embed",
        url: `https://content.jwplatform.com/players/${block.mediaId}-whqXCOFb.html`,
      })
      return
    }
    if (Array.isArray(block.blocks)) {
      for (const child of block.blocks) walk(child)
    }
  }

  for (const block of root.blocks) walk(block)
  return events
}

function sourceNote(folder, sourceUrl) {
  const noun =
    folder === "recensies" ? "recensie" : folder === "interviews" ? "interview" : "artikel"
  const demonstrative = noun === "recensie" ? "Deze" : "Dit"
  return `> [!NOTE]\n> ${demonstrative} ${noun} verscheen eerder op [NU.nl](${sourceUrl}).`
}

function insertSourceNote(markdown, note) {
  const blocks = markdown.split(/\n{2,}/)
  let leadIndex = blocks.findIndex(
    (block) => block.trim() && !/^(#|>|!\[|\[Bekijk ingesloten media\])/.test(block.trim()),
  )
  if (leadIndex < 0) leadIndex = 0
  blocks.splice(leadIndex + 1, 0, note)
  return blocks.join("\n\n")
}

function normalizeSourceNote(body, note) {
  const pattern = /> \[!NOTE\][\s\S]{0,280}?(?=\n\n|$)/i
  if (pattern.test(body) && /\bNU\.nl\b/i.test(body.match(pattern)?.[0] || "")) {
    return body.replace(pattern, note)
  }
  return insertSourceNote(body, note)
}

async function articleMarkdown(meta, { slug, relativePrefix, folder }) {
  const parts = []
  for (const event of articleEvents(meta)) {
    if (event.type === "html") {
      const markdown = turndown.turndown(event.html).trim()
      if (markdown) parts.push(markdown)
    } else if (event.type === "heading") {
      parts.push(`## ${event.text}`)
    } else if (event.type === "embed") {
      parts.push(`[Bekijk ingesloten media](${event.url})`)
    } else if (event.type === "image") {
      const local = await downloadImage(event.image.url, slug)
      if (!local) continue
      const imageMarkdown = `![${event.image.alt}](${relativePrefix}${local})`
      parts.push(
        event.image.caption ? `${imageMarkdown}\n\n_${event.image.caption}_` : imageMarkdown,
      )
    }
  }

  let markdown = parts
    .join("\n\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  const extractedWords = cleanText(markdown).split(/\s+/).filter(Boolean).length
  if (extractedWords < Math.max(80, meta.wordCount * 0.7)) {
    const headings = new Set(
      meta
        .$("main h2")
        .map((_index, element) => cleanText(meta.$(element).text()))
        .get(),
    )
    const lines = cleanText(meta.schema.articleBody)
      ? meta.schema.articleBody
          .split(/\n+/)
          .map((line) => cleanText(line))
          .filter(Boolean)
      : []
    if (lines[0] === meta.title) lines.shift()
    if (lines[0] === meta.description) lines.shift()
    markdown = lines.map((line) => (headings.has(line) ? `## ${line}` : line)).join("\n\n")
  }
  const finalWords = cleanText(markdown).split(/\s+/).filter(Boolean).length
  if (finalWords < Math.max(80, meta.wordCount * 0.7)) {
    throw new Error(`artikeltekst lijkt onvolledig (${finalWords}/${meta.wordCount} woorden)`)
  }
  return insertSourceNote(markdown, sourceNote(folder, meta.sourceUrl))
}

function baseSlug(item, sourceUrl) {
  const pathname = new URL(sourceUrl || item.url).pathname
  const lastPart = pathname.split("/").filter(Boolean).at(-1) || item.title
  return slugify(lastPart.replace(/\.html$/i, ""))
}

function aliasesFor(folder, slug) {
  return folder
    ? [`/${slug}`, `/artikelen/${slug}`, `/artikelen/${folder}/${slug}`]
    : [`/artikelen/${slug}`]
}

function subjectTags(sourceUrl, title, sections = []) {
  const gamePattern =
    /\b(?:gam(?:e|en|er|ers|ing|ebeurs|e-industrie)|nintendo|playstation|xbox|pok[eé]mon|zelda|fortnite|twitch|steam|gta|warcraft|mario|diablo|minecraft)\b/i
  const games = sections.includes("games") || gamePattern.test(`${title} ${sourceUrl}`)
  return [games ? "Games" : "Technologie", "Elders gepubliceerd", "NU.nl"]
}

async function writeMarkdown(filename, data, body) {
  if (!DRY_RUN) {
    await fs.mkdir(path.dirname(filename), { recursive: true })
    await fs.writeFile(filename, `${yamlFrontmatter(data)}\n\n${body.trim()}\n`)
  }
}

async function updateExisting(plan, meta) {
  const { record, relativePath, slug, folder } = plan
  const destination = path.join(CONTENT_DIR, relativePath)
  const relativePrefix = folder ? "../" : "./"
  const localImage = await downloadImage(meta.schema.primaryImageOfPage, slug)
  const tags = unique([
    ...(record.data.tags || []).filter(
      (tag) =>
        !/^(?:review|interview|games|technologie|elders gepubliceerd|nu\.nl)$/i.test(String(tag)),
    ),
    ...subjectTags(meta.sourceUrl, meta.title, meta.sections),
  ])
  const data = {
    ...record.data,
    title: meta.title,
    description: meta.description || record.data.description,
    published: meta.published || record.data.published,
    modified: meta.modified || record.data.modified,
    tags,
    aliases: unique([...(record.data.aliases || []), ...aliasesFor(folder, slug)]),
    author: "Bastiaan Vroegop",
    source: "NU.nl",
    sourceUrl: meta.sourceUrl,
    ...(localImage ? { socialImage: `${relativePrefix}${localImage}` } : {}),
    publish: true,
  }
  const body = normalizeSourceNote(record.body, sourceNote(folder, meta.sourceUrl))

  if (!DRY_RUN && record.filename !== destination) {
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.rename(record.filename, destination)
    report.moved += 1
  }
  await writeMarkdown(destination, data, body)
  report.existing += 1
  report.updatedMetadata += 1
  report.files.push(relativePath)
}

async function importNew(plan, meta) {
  const { relativePath, slug, folder } = plan
  const relativePrefix = folder ? "../" : "./"
  const markdown = await articleMarkdown(meta, { slug, relativePrefix, folder })
  const localImage = await downloadImage(meta.schema.primaryImageOfPage, slug)
  const data = {
    title: meta.title,
    description: meta.description,
    published: meta.published,
    modified: meta.modified,
    tags: subjectTags(meta.sourceUrl, meta.title, meta.sections),
    aliases: aliasesFor(folder, slug),
    author: "Bastiaan Vroegop",
    source: "NU.nl",
    sourceUrl: meta.sourceUrl,
    ...(localImage ? { socialImage: `${relativePrefix}${localImage}` } : {}),
    publish: true,
  }
  await writeMarkdown(path.join(CONTENT_DIR, relativePath), data, markdown)
  report.imported += 1
  report.files.push(relativePath)
}

function reservePlans(items, records) {
  const occupied = new Set(records.map((record) => record.relativePath))
  const byId = new Map()
  for (const record of records) {
    for (const id of record.ids) byId.set(id, record)
  }

  return items.map((item) => {
    const record = byId.get(item.id)
    const folder = item.folder || ""
    const preferredSlug = baseSlug(item, item.url)
    let slug = preferredSlug
    let relativePath = path.posix.join(folder, `${slug}.md`)
    if (record) occupied.delete(record.relativePath)
    if (occupied.has(relativePath)) {
      slug = `${preferredSlug}-nu`
      relativePath = path.posix.join(folder, `${slug}.md`)
      let counter = 2
      while (occupied.has(relativePath)) {
        slug = `${preferredSlug}-nu-${counter}`
        relativePath = path.posix.join(folder, `${slug}.md`)
        counter += 1
      }
    }
    occupied.add(relativePath)
    return { item, record, folder, slug, relativePath }
  })
}

async function main() {
  const inventory = JSON.parse(await fs.readFile(INVENTORY_PATH, "utf8"))
  report.discovered = inventory.length
  report.excludedAsNews = inventory.filter(
    (item) => !item.include && item.selection === "routine-nieuws",
  ).length
  report.excludedMonthlyOverview = inventory.filter(
    (item) => !item.include && item.selection === "maandoverzicht",
  ).length
  report.excludedOtherAuthor = inventory.filter(
    (item) => !item.include && item.selection === "andere-auteur",
  ).length
  let selected = inventory.filter((item) => item.include)
  if (Number.isFinite(LIMIT)) selected = selected.slice(0, LIMIT)
  report.selected = selected.length

  const records = await existingInventory()
  const plans = reservePlans(selected, records)
  let completed = 0
  await mapConcurrent(plans, CONCURRENCY, async (plan) => {
    try {
      const html = await fetchArticleHtml(plan.item)
      const meta = articleMeta(html, plan.item)
      if (plan.record && !FORCE) await updateExisting(plan, meta)
      else await importNew(plan, meta)
    } catch (error) {
      report.failures.push({
        title: plan.item.title,
        url: plan.item.url,
        error: error.message,
      })
    }
    completed += 1
    if (completed % 20 === 0 || completed === plans.length) {
      process.stdout.write(`${completed}/${plans.length}\n`)
    }
  })

  report.files.sort()
  if (!DRY_RUN) await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(
    `Klaar: ${report.imported} geïmporteerd, ${report.existing} bijgewerkt, ` +
      `${report.failures.length} fouten, ${report.images.downloaded} afbeeldingen gedownload.\n`,
  )
  if (report.failures.length) process.exitCode = 1
}

await main()
