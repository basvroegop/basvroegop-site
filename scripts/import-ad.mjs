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
const MEDIA_DIR = path.join(CONTENT_DIR, "media", "ad")
const INVENTORY_PATH = path.join(ROOT, "data", "ad-publications.json")
const REPORT_PATH = path.join(ROOT, "data", "ad-import-report.json")
const CACHE_DIR = process.env.AD_CACHE_DIR
const SITE_ROOT = "https://www.ad.nl"
const CONCURRENCY = 5
const IMAGE_WIDTH = 1200
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const FORCE = process.argv.includes("--force")
const DRY_RUN = process.argv.includes("--dry-run")
const SKIP_IMAGES = process.argv.includes("--no-images")
const limitArgument = process.argv.find((argument) => argument.startsWith("--limit="))
const LIMIT = limitArgument ? Number(limitArgument.split("=")[1]) : undefined

const HEADERS = {
  "user-agent": "Mozilla/5.0 (compatible; BasVroegopArchive/1.0)",
  "accept-language": "nl-NL,nl;q=0.9,en;q=0.8",
}

const reviewLabels = new Set([
  "review",
  "hands-on",
  "serierecensie",
  "tweakers",
  "best getest",
  "black friday",
])

const interviewIds = new Set([
  "a20b774a", // Sarah Verhoeven
  "a4842ab5", // Tim Cook
  "a1c15387", // Spider-Man 2-makers
  "a2dba9c9", // GTA-maker Obbe Vermeij
  "a75760e5", // Apple na de gijzeling
])

const report = {
  generatedAt: new Date().toISOString(),
  discovered: 0,
  selected: 0,
  excludedAsNews: 0,
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
turndown.addRule("figure", {
  filter: "figure",
  replacement(content) {
    return `\n\n${content.trim()}\n\n`
  },
})
turndown.addRule("iframe", {
  filter: "iframe",
  replacement(_content, node) {
    const src = node.getAttribute("src")
    return src ? `\n\n[Bekijk ingesloten media](${src})\n\n` : ""
  },
})
turndown.addRule("video", {
  filter: "video",
  replacement(_content, node) {
    const src = node.getAttribute("src") || node.querySelector("source")?.getAttribute("src")
    return src ? `\n\n[Bekijk ingesloten media](${src})\n\n` : ""
  },
})

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
    url.hash = ""
    url.search = ""
    return url.href.replace(/\/$/, "")
  } catch {
    return value
  }
}

function adId(value) {
  return canonicalUrl(value)
    ?.match(/~(a[0-9a-f]+)$/i)?.[1]
    ?.toLowerCase()
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
    if (String(data.source || "").toLowerCase() === "ad") {
      const id = adId(data.sourceUrl)
      if (id) ids.add(id)
    }
    const sourceNote = body.match(
      /> \[!NOTE\][\s\S]{0,240}?\(https?:\/\/(?:www\.)?ad\.nl\/[^)]+\)/i,
    )?.[0]
    if (sourceNote) {
      const id = adId(sourceNote.match(/https?:\/\/[^)]+/)?.[0])
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
    await new Promise((resolve) => setTimeout(resolve, 400 * attempt))
  }
  throw lastError
}

async function fetchArticleHtml(item) {
  const id = adId(item.url)?.slice(1)
  if (CACHE_DIR && id) {
    try {
      return await fs.readFile(path.join(CACHE_DIR, `${id}.html`), "utf8")
    } catch {
      // Fetch the page when it is not present in the optional research cache.
    }
  }
  return (await fetchResponse(item.url)).text()
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

function imageSource($, element) {
  const image = $(element)
  const srcset = image.attr("srcset") || image.attr("data-srcset")
  if (srcset) {
    const candidate = srcset
      .split(",")
      .map((value) => value.trim().split(/\s+/)[0])
      .filter(Boolean)
      .at(-1)
    if (candidate) return candidate
  }
  const direct = image.attr("src") || image.attr("data-src") || image.attr("data-lazy-src")
  return direct && !direct.startsWith("data:") ? direct : undefined
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
      return path.posix.join("media", "ad", slug, cached)
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
  return path.posix.join("media", "ad", slug, filename)
}

function articleMeta(html, item) {
  const $ = load(html)
  const meta = (name) => $(`meta[name="${name}"]`).attr("content")
  const property = (name) => $(`meta[property="${name}"]`).attr("content")
  const sourceUrl = $("link[rel=canonical]").attr("href") || item.url
  const author =
    meta("cXenseParse:dpn-content_author") || meta("author") || property("article:author")
  if (author !== "Bastiaan Vroegop") {
    throw new Error(`onverwachte AD-auteur: ${author || "onbekend"}`)
  }
  return {
    $,
    sourceUrl,
    author,
    title: meta("cXenseParse:dpn-content_title") || property("og:title") || item.title,
    description: cleanText(meta("description")),
    label: meta("cXenseParse:dpn-content_label") || item.label,
    published: isoDate(
      meta("cXenseParse:dpn-content_publication_date") || property("article:published_time"),
    ),
    modified: isoDate(property("article:modified_time")),
  }
}

function isReview(item, label = item.label) {
  return (
    item.folder === "recensies" ||
    reviewLabels.has(cleanText(label).toLowerCase()) ||
    /^(?:review|getest):?/i.test(cleanText(item.title)) ||
    /\b(?:we hebben|wij hebben)\b.{0,50}\b(?:getest|geprobeerd)\b/i.test(cleanText(item.title))
  )
}

function isInterview(item, label = item.label) {
  return (
    item.folder === "interviews" ||
    /^interview$/i.test(cleanText(label)) ||
    interviewIds.has(adId(item.url))
  )
}

function routeFolder(item, label) {
  if (isReview(item, label)) return "recensies"
  if (isInterview(item, label)) return "interviews"
  return ""
}

function baseSlug(item, sourceUrl) {
  const pathname = new URL(sourceUrl || item.url).pathname
  const lastPart = pathname.split("/").filter(Boolean).at(-1) || item.title
  return slugify(lastPart.replace(/~a[0-9a-f]+$/i, ""))
}

function aliasesFor(folder, slug) {
  return folder
    ? [`/${slug}`, `/artikelen/${slug}`, `/artikelen/${folder}/${slug}`]
    : [`/artikelen/${slug}`]
}

function subjectTags(sourceUrl, title) {
  const gamePattern =
    /\b(?:gam(?:e|en|er|ers|ing|emaker|emakers|ebedrijf|ebedrijven|e-industrie)|nintendo|playstation|xbox|pok[eé]mon|zelda|fortnite|twitch|steam|gta|world of warcraft|final fantasy|sonic|minecraft)\b/i
  const pathIsGames = new URL(sourceUrl).pathname.startsWith("/games/")
  return [
    pathIsGames || gamePattern.test(title) ? "Games" : "Technologie",
    "Elders gepubliceerd",
    "AD",
  ]
}

function sourceNote(folder, sourceUrl) {
  const noun =
    folder === "recensies" ? "recensie" : folder === "interviews" ? "interview" : "artikel"
  const demonstrative = noun === "recensie" ? "Deze" : "Dit"
  return `> [!NOTE]\n> ${demonstrative} ${noun} verscheen eerder op [AD](${sourceUrl}).`
}

function insertSourceNote(markdown, note) {
  const blocks = markdown.split(/\n{2,}/)
  let leadIndex = blocks.findIndex(
    (block) => block.trim() && !/^(#|>|!\[|\*\*?(?:Bron|Foto|Beeld):)/.test(block.trim()),
  )
  if (leadIndex < 0) leadIndex = 0
  blocks.splice(leadIndex + 1, 0, note)
  return blocks.join("\n\n")
}

function normalizeSourceNote(body, note) {
  const pattern = /> \[!NOTE\][\s\S]{0,260}?(?=\n\n|$)/i
  if (pattern.test(body) && /\bAD\b/i.test(body.match(pattern)?.[0] || "")) {
    return body.replace(pattern, note)
  }
  return insertSourceNote(body, note)
}

function componentHtml($, element) {
  const component = $(element)
  const type = component.attr("data-content-type")
  if (type === "PARAGRAPH" || type === "SUBHEADER") {
    const text = component.find(".text").first()
    return text.length ? $.html(text) : ""
  }
  if (type === "IMAGE") {
    const image = component.find("img").first()
    if (!image.length) return ""
    const caption = cleanText(component.find("figcaption").first().text())
    return `<figure>${$.html(image)}${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`
  }
  if (type === "QUOTE") {
    const quote = component.find("blockquote").first()
    return quote.length ? $.html(quote) : `<blockquote>${cleanText(component.text())}</blockquote>`
  }
  if (type === "QUESTION") {
    const question = cleanText(component.text())
    return question ? `<h2>${question}</h2>` : ""
  }
  if (type === "REVIEW") {
    const details = cleanText(component.text())
    return details ? `<blockquote>${details}</blockquote>` : ""
  }
  return ""
}

async function articleMarkdown($, { slug, relativePrefix, folder, sourceUrl }) {
  const container = load("<main></main>", null, false)
  const intro = $("article [data-content-type=INTRO] .text").first()
  if (intro.length) container("main").append(`<p>${intro.html()}</p>`)

  const supported = new Set(["PARAGRAPH", "SUBHEADER", "IMAGE", "QUOTE", "QUESTION", "REVIEW"])
  $("article [data-content-type]").each((_index, element) => {
    if (!supported.has($(element).attr("data-content-type"))) return
    const html = componentHtml($, element)
    if (html) container("main").append(html)
  })
  container("script, style, noscript, svg").remove()

  for (const element of container("img").toArray()) {
    const source = imageSource(container, element)
    if (!source) {
      container(element).remove()
      continue
    }
    const local = await downloadImage(source, slug)
    if (!local) {
      container(element).remove()
      continue
    }
    container(element)
      .attr("src", `${relativePrefix}${local}`)
      .removeAttr("srcset")
      .removeAttr("data-srcset")
      .removeAttr("data-src")
      .removeAttr("data-lazy-src")
      .removeAttr("sizes")
      .removeAttr("loading")
      .removeAttr("width")
      .removeAttr("height")
      .removeAttr("class")
      .removeAttr("style")
  }

  let markdown = turndown
    .turndown(container("main").html() || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  if (markdown.split(/\s+/).length < 120) {
    throw new Error(`artikeltekst lijkt onvolledig (${markdown.split(/\s+/).length} woorden)`)
  }
  markdown = insertSourceNote(markdown, sourceNote(folder, sourceUrl))
  return markdown
}

function leadImageSource($) {
  const image = $("article [data-content-type=MEDIA_TOP] img").first()
  return image.length ? imageSource($, image) : undefined
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
  const localImage = await downloadImage(leadImageSource(meta.$), slug)
  const tags = unique([
    ...(record.data.tags || []).filter(
      (tag) => !/^(?:review|interview|games|technologie)$/i.test(String(tag)),
    ),
    ...subjectTags(meta.sourceUrl, meta.title),
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
    source: "AD",
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
  const markdown = await articleMarkdown(meta.$, {
    slug,
    relativePrefix,
    folder,
    sourceUrl: meta.sourceUrl,
  })
  const localImage = await downloadImage(leadImageSource(meta.$), slug)
  const data = {
    title: meta.title,
    description: meta.description,
    published: meta.published,
    modified: meta.modified,
    tags: subjectTags(meta.sourceUrl, meta.title),
    aliases: aliasesFor(folder, slug),
    author: "Bastiaan Vroegop",
    source: "AD",
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
    const id = adId(item.url)
    const record = byId.get(id)
    const folder = routeFolder(item, item.label)
    const preferredSlug = baseSlug(item, item.url)
    let slug = preferredSlug
    let relativePath = path.posix.join(folder, `${slug}.md`)
    if (record) occupied.delete(record.relativePath)
    if (occupied.has(relativePath)) {
      slug = `${preferredSlug}-ad`
      relativePath = path.posix.join(folder, `${slug}.md`)
      let counter = 2
      while (occupied.has(relativePath)) {
        slug = `${preferredSlug}-ad-${counter}`
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
  report.excludedAsNews = inventory.filter((item) => !item.include).length
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
      const actualFolder = routeFolder(plan.item, meta.label)
      if (actualFolder !== plan.folder) {
        throw new Error(
          `map veranderde na paginacontrole (${plan.folder || "hoofdmap"} → ${actualFolder})`,
        )
      }
      if (plan.record && !FORCE) await updateExisting(plan, meta)
      else await importNew(plan, meta)
    } catch (error) {
      report.failures.push({ title: plan.item.title, url: plan.item.url, error: error.message })
    }
    completed += 1
    process.stdout.write(`\rAD-import: ${completed}/${plans.length}`)
  })
  process.stdout.write("\n")

  if (!DRY_RUN) {
    await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  }
  console.log(
    `AD: ${report.discovered} gevonden, ${report.selected} geselecteerd, ${report.imported} geïmporteerd, ${report.existing} bijgewerkt, ${report.excludedAsNews} nieuwsitems overgeslagen.`,
  )
  console.log(
    `Afbeeldingen: ${report.images.downloaded} gedownload, ${report.images.reused} hergebruikt, ${report.images.skipped.length} overgeslagen.`,
  )
  if (report.failures.length) {
    for (const failure of report.failures) console.error(`- ${failure.title}: ${failure.error}`)
    process.exitCode = 1
  }
}

await main()
