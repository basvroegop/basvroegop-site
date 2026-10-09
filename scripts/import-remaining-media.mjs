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
const DATA_DIR = path.join(ROOT, "data")
const WAYBACK_TIMESTAMP = "20260419112958"
const HEADERS = {
  "user-agent": "Mozilla/5.0 (compatible; BasVroegopArchive/1.0)",
  "accept-language": "nl-NL,nl;q=0.9,en;q=0.8",
}
const IMAGE_WIDTH = 1200
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const DRY_RUN = process.argv.includes("--dry-run")
const SKIP_IMAGES = process.argv.includes("--no-images")
const ONLY = process.argv.find((value) => value.startsWith("--only="))?.split("=")[1]

const report = {
  generatedAt: new Date().toISOString(),
  normalized: { gamer: 0, insideGamer: 0, powerUnlimited: 0, laadscherm: 0 },
  imported: { gamerPu: 0, kidsweek: 0, unpause: 0 },
  existing: 0,
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
turndown.addRule("iframe", {
  filter: "iframe",
  replacement(_content, node) {
    const src = node.getAttribute("src") || node.getAttribute("data-src")
    return src ? `\n\n[Bekijk ingesloten media](${normalizeEmbedUrl(src)})\n\n` : ""
  },
})
turndown.addRule("lazyEmbed", {
  filter(node) {
    return node.nodeName === "DIV" && Boolean(node.getAttribute("data-src"))
  },
  replacement(_content, node) {
    return `\n\n[Bekijk ingesloten media](${normalizeEmbedUrl(node.getAttribute("data-src"))})\n\n`
  },
})

function normalizeEmbedUrl(value) {
  if (!value) return value
  return value.startsWith("//") ? `https:${value}` : value
}

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

function normalizedTitle(value) {
  return slugify(
    cleanText(value)
      .replace(/^(?:gamerecensie|recensie|review|preview|gespeeld|interview|favorieten):?\s*/i, "")
      .replace(/\s+[-|]\s+(?:Unpause|Kidsweek|PU\.nl).*$/i, ""),
  )
}

function isoDate(value) {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString().slice(0, 10)
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function excerpt(value, maxLength = 300) {
  const text = cleanText(value)
  if (!text) return undefined
  if (text.length <= maxLength) return text
  return `${text
    .slice(0, maxLength + 1)
    .replace(/\s+\S*$/, "")
    .trim()}…`
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

async function listMarkdown(directory = CONTENT_DIR) {
  const files = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await listMarkdown(filename)))
    else if (entry.name.endsWith(".md")) files.push(filename)
  }
  return files
}

async function inventory() {
  const records = []
  for (const filename of await listMarkdown()) {
    const markdown = await fs.readFile(filename, "utf8")
    const { data, body } = parseMarkdown(markdown)
    records.push({
      filename,
      markdown,
      data,
      body,
      title: normalizedTitle(data.title),
      sourceUrl: canonicalUrl(data.sourceUrl),
    })
  }
  return records
}

function canonicalUrl(value) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    url.hash = ""
    url.searchParams.delete("ref")
    const result = url.href.replace(/\/$/, "")
    return result
  } catch {
    return value
  }
}

async function fetchResponse(url, attempts = 4) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 75_000)
    try {
      const response = await fetch(url, {
        headers: HEADERS,
        redirect: "follow",
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (response.ok) return response
      lastError = new Error(`${response.status} ${response.statusText} voor ${url}`)
      if (response.status < 500 && response.status !== 429) break
    } catch (error) {
      clearTimeout(timeout)
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
  }
  throw lastError
}

async function fetchWayback(url) {
  const exact = `https://web.archive.org/web/${WAYBACK_TIMESTAMP}id_/${url}`
  try {
    return { html: await (await fetchResponse(exact, 2)).text(), fetchUrl: exact }
  } catch {
    const latest = `https://web.archive.org/web/2id_/${url}`
    return { html: await (await fetchResponse(latest, 3)).text(), fetchUrl: latest }
  }
}

function archivePageUrl(url) {
  return `https://web.archive.org/web/${WAYBACK_TIMESTAMP}/${url}`
}

function unwrapImageUrl(value, archived = false) {
  if (!value) return undefined
  const normalized = normalizeEmbedUrl(value.replace(/&amp;/g, "&"))
  try {
    const url = new URL(normalized)
    if (url.hostname === "api.gamer.nl" && url.searchParams.get("url")) {
      return url.searchParams.get("url")
    }
    if (archived && ["pu.nl", "www.pu.nl"].includes(url.hostname)) {
      return `https://web.archive.org/web/${WAYBACK_TIMESTAMP}id_/${url.href}`
    }
    return url.href
  } catch {
    return normalized
  }
}

async function downloadImage(urlValue, sourceSlug, articleSlug, archived = false) {
  if (!urlValue || SKIP_IMAGES) return undefined
  const url = unwrapImageUrl(urlValue, archived)
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 12)
  const destinationDir = path.join(CONTENT_DIR, "media", sourceSlug, articleSlug)
  if (!DRY_RUN) await fs.mkdir(destinationDir, { recursive: true })
  try {
    const existing = (await fs.readdir(destinationDir)).find((name) => name.startsWith(`${hash}.`))
    if (existing) {
      report.images.reused += 1
      return path.posix.join("media", sourceSlug, articleSlug, existing)
    }
  } catch {
    // The directory is created above outside dry runs.
  }

  try {
    const response = await fetchResponse(url, 3)
    const contentType = response.headers.get("content-type") || ""
    const input = Buffer.from(await response.arrayBuffer())
    if (!contentType.startsWith("image/") || input.length > MAX_IMAGE_BYTES) {
      throw new Error(`ongeldige afbeelding (${contentType || "onbekend"}, ${input.length} bytes)`)
    }
    const passthrough = /image\/(gif|svg\+xml)/.test(contentType)
    const extension = contentType.includes("gif")
      ? ".gif"
      : contentType.includes("svg")
        ? ".svg"
        : ".webp"
    const destination = path.join(destinationDir, `${hash}${extension}`)
    if (!DRY_RUN) {
      if (passthrough) await fs.writeFile(destination, input)
      else
        await sharp(input)
          .rotate()
          .resize({ width: IMAGE_WIDTH, withoutEnlargement: true })
          .webp({ quality: 82 })
          .toFile(destination)
    }
    report.images.downloaded += 1
    return path.posix.join("media", sourceSlug, articleSlug, `${hash}${extension}`)
  } catch (error) {
    report.images.skipped.push({ url, reason: error.message })
    return undefined
  }
}

function relativeMediaPath(mediaPath, folder) {
  if (!mediaPath) return undefined
  return `${folder ? "../" : "./"}${mediaPath}`
}

function sourceNote(source, url, folder, title = "") {
  const noun =
    folder === "recensies"
      ? "Deze recensie"
      : folder === "interviews"
        ? "Dit interview"
        : /preview|gespeeld/i.test(title)
          ? "Deze preview"
          : "Dit artikel"
  return `> [!NOTE]\n>\n> ${noun} verscheen eerder op [${source}](${url}).`
}

function cleanConvertedMarkdown(value) {
  return value
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/g, "")
    .replace(/\\([.!?])/g, "$1")
}

async function writeArticle({ item, parsed, sourceSlug, linkUrl }) {
  if (!parsed.title || !parsed.body) throw new Error("titel of artikeltekst ontbreekt")
  if (!/Bastiaan|BasVroegop/i.test(parsed.author || "")) {
    throw new Error(`onverwachte auteur: ${parsed.author || "onbekend"}`)
  }

  const current = await inventory()
  const match = current.find(
    (record) =>
      record.sourceUrl === canonicalUrl(item.sourceUrl) ||
      (record.title && record.title === normalizedTitle(parsed.title)),
  )
  if (match) {
    const data = {
      ...match.data,
      published: isoDate(parsed.date) || match.data.published,
      modified: isoDate(parsed.modified) || match.data.modified,
      author: "Bastiaan Vroegop",
      source: item.source,
      sourceUrl: item.sourceUrl,
      publish: true,
    }
    const updated = `${yamlFrontmatter(data)}\n\n${match.body}\n`
    if (updated !== match.markdown && !DRY_RUN) await fs.writeFile(match.filename, updated)
    report.existing += 1
    return
  }

  const slug = slugify(parsed.title)
  const folder = item.folder || ""
  const media = await downloadImage(parsed.image, sourceSlug, slug, item.archived)
  const tags = unique(["Games", "Elders gepubliceerd", item.source])
  const aliases = [`/${slug}`, `/artikelen/${slug}`]
  if (folder) aliases.push(`/artikelen/${folder}/${slug}`)
  const frontmatter = yamlFrontmatter({
    title: cleanText(parsed.title),
    description: excerpt(parsed.description || parsed.intro || parsed.body),
    published: isoDate(parsed.date),
    modified: isoDate(parsed.modified),
    tags,
    aliases,
    author: "Bastiaan Vroegop",
    source: item.source,
    sourceUrl: item.sourceUrl,
    archiveUrl: item.archived ? linkUrl : undefined,
    socialImage: relativeMediaPath(media, folder),
    publish: true,
  })
  const intro = cleanText(parsed.intro)
  const body = cleanConvertedMarkdown(parsed.body)
  const pieces = [frontmatter]
  if (intro && !cleanText(body).startsWith(intro.slice(0, 100))) pieces.push(`**${intro}**`)
  pieces.push(sourceNote(item.source, linkUrl, folder, parsed.title), body)
  const outputDir = path.join(CONTENT_DIR, folder)
  const destination = path.join(outputDir, `${slug}.md`)
  if (!DRY_RUN) {
    await fs.mkdir(outputDir, { recursive: true })
    await fs.writeFile(destination, `${pieces.join("\n\n")}\n`)
  }
  report.files.push(path.relative(ROOT, destination))
  return destination
}

function articleFromJsonLd($, selector = 'script[type="application/ld+json"]') {
  const values = []
  $(selector).each((_, element) => {
    try {
      const value = JSON.parse($(element).html())
      const candidates = Array.isArray(value) ? value : value?.["@graph"] || [value]
      values.push(...candidates)
    } catch {
      // Ignore unrelated invalid structured-data blocks.
    }
  })
  return values.find((value) => /(?:News)?Article|Review/.test(String(value?.["@type"])))
}

function stripRemoteImages($body) {
  $body(
    "picture, figure, noscript, .rs-snippet__image, .photoswipe, .wp-block-image, div.relative.cursor-pointer",
  ).remove()
  $body("img").remove()
  $body("script, style, form").remove()
}

function parseGamerPu(html) {
  const $ = load(html)
  let next
  try {
    next = JSON.parse($("#__NEXT_DATA__").text())
  } catch {
    // Modern migrated Gamer pages are Astro pages and do not have Next data.
  }
  const resources = next?.props?.pageProps?._resources
  const legacy = resources?.article || resources?.blox_article?.data?.article?.[0]
  if (legacy) {
    const htmlBody = legacy.html || legacy.body
    const $body = load(`<body>${htmlBody}</body>`)
    stripRemoteImages($body)
    const author = legacy.author?.fullName || legacy.author?.name
    const isBas = /Bastiaan Vroegop|BasVroegop/i.test(author || "")
    return {
      title: legacy.title,
      intro: legacy.intro || legacy.article_intro,
      description: legacy.metaDescription || legacy.intro || legacy.article_intro,
      date: legacy.publishDate || legacy.meta?.first_published_at,
      modified: legacy.updatedAt,
      author: isBas ? "Bastiaan Vroegop" : author,
      image: legacy.mediaUrl || legacy.header_image || legacy.media?.file?.url,
      body: turndown.turndown($body("body").html() || ""),
    }
  }

  const data = articleFromJsonLd($, '#page-script, script[type="application/ld+json"]')
  const firstParagraph = $("article p.my-4").first()
  const content = firstParagraph.length
    ? firstParagraph.parent().clone()
    : $(".entry-content").first().clone()
  if (content.length) {
    const children = content.children()
    let cutoff = children.length
    children.each((index, element) => {
      const className = $(element).attr("class") || ""
      if (cutoff === children.length && /(?:^|\s)mt-6(?:\s|$)/.test(className)) cutoff = index
    })
    children.slice(cutoff).remove()
  }
  const $body = load(`<body>${content.html() || ""}</body>`)
  stripRemoteImages($body)
  return {
    title: data?.headline || $("h1").first().text(),
    intro: content.find("p.intro-line").first().text(),
    description: data?.description || $('meta[name="description"]').attr("content"),
    date: data?.datePublished,
    modified: data?.dateModified,
    author: typeof data?.author === "string" ? data.author : data?.author?.name,
    image:
      typeof data?.image === "string"
        ? data.image
        : data?.image?.url || $('meta[name="og:image"]').attr("content"),
    body: turndown.turndown($body("body").html() || ""),
  }
}

async function importGamerPu() {
  const items = JSON.parse(
    await fs.readFile(path.join(DATA_DIR, "gamer-pu-publications.json"), "utf8"),
  )
  const existingSourceUrls = new Set(
    (await inventory()).map((record) => record.sourceUrl).filter(Boolean),
  )
  for (const item of items) {
    if (existingSourceUrls.has(canonicalUrl(item.sourceUrl))) {
      report.existing += 1
      continue
    }
    try {
      const { html } = await fetchWayback(item.fetchUrl)
      const parsed = parseGamerPu(html)
      item.archived = true
      const written = await writeArticle({
        item,
        parsed,
        sourceSlug: "gamer-pu",
        linkUrl: archivePageUrl(item.fetchUrl),
      })
      if (written) {
        report.imported.gamerPu += 1
        existingSourceUrls.add(canonicalUrl(item.sourceUrl))
      }
    } catch (error) {
      report.failures.push({ source: item.source, url: item.fetchUrl, reason: error.message })
    }
  }
}

async function normalizeLegacySources() {
  const gamerPuItems = JSON.parse(
    await fs.readFile(path.join(DATA_DIR, "gamer-pu-publications.json"), "utf8"),
  )
  for (const record of await inventory()) {
    const importedItem = gamerPuItems.find(
      (item) =>
        record.data.archiveUrl?.includes(item.fetchUrl) ||
        canonicalUrl(record.data.sourceUrl) === canonicalUrl(item.sourceUrl),
    )
    let source = importedItem?.source
    if (!source && /verscheen eerder[\s\S]{0,160}?Insidegamer/i.test(record.body))
      source = "InsideGamer"
    else if (!source && /verscheen eerder[\s\S]{0,160}?(?:Gamer\.nl|Gamer\b)/i.test(record.body))
      source = "Gamer.nl"
    else if (!source && /verscheen eerder[\s\S]{0,160}?Power Unlimited/i.test(record.body))
      source = "Power Unlimited"
    else if (!source && /verscheen eerder[\s\S]{0,160}?(?:op )?Laadscherm/i.test(record.body))
      source = "Laadscherm"
    else if (
      !source &&
      record.filename.endsWith("ik-las-een-boek-dat-alleen-maar-potjes-dungeon-keeper-beschreef.md")
    )
      source = "Laadscherm"
    if (!source) continue

    const domains =
      source === "Gamer.nl"
        ? /https?:\/\/(?:www\.)?gamer\.nl\/[^\s)>]+/i
        : source === "InsideGamer"
          ? /https?:\/\/inside\.gamer\.nl\/[^\s)>]+/i
          : source === "Power Unlimited"
            ? /https?:\/\/(?:www\.)?pu\.nl\/[^\s)>]+/i
            : /https?:\/\/(?:www\.)?laadscherm\.nl\/[^\s)>]+/i
    const rawUrl = record.body.match(domains)?.[0]?.replace(/[.,]$/, "")
    const sourceUrl = importedItem
      ? importedItem.sourceUrl
      : record.data.source === source && record.data.sourceUrl
        ? record.data.sourceUrl
        : rawUrl
          ? canonicalUrl(rawUrl)
          : record.filename.endsWith(
                "ik-las-een-boek-dat-alleen-maar-potjes-dungeon-keeper-beschreef.md",
              )
            ? "https://laadscherm.nl/las-boek-alleen-potjes-dungeon-keeper-beschreef"
            : record.data.source === source
              ? record.data.sourceUrl
              : undefined
    const data = {
      ...record.data,
      tags: unique([...(record.data.tags || []), "Elders gepubliceerd", source]),
      author: "Bastiaan Vroegop",
      source,
      sourceUrl,
      publish: true,
    }
    const body = record.body
      .replace(/\?ref=gamepraat\.nl(?=\))/g, "")
      .replace(/^!\[[^\n]*api\.gamer\.nl[^\n]*\n?/gm, "")
      .replace(/^©GMRimport\s*\n?/gm, "")
      .replace(/\n{3,}/g, "\n\n")
    const updated = `${yamlFrontmatter(data)}\n\n${body}\n`
    if (updated !== record.markdown) {
      if (!DRY_RUN) await fs.writeFile(record.filename, updated)
      if (source === "Gamer.nl") report.normalized.gamer += 1
      else if (source === "InsideGamer") report.normalized.insideGamer += 1
      else if (source === "Power Unlimited") report.normalized.powerUnlimited += 1
      else report.normalized.laadscherm += 1
    }
  }
}

async function discoverKidsweek() {
  const urls = []
  for (const suffix of ["", "/p2"]) {
    const pageUrl = `https://www.kidsweek.nl/auteur/bastiaan-vroegop${suffix}`
    const $ = load(await (await fetchResponse(pageUrl)).text())
    $("a[href]").each((_, element) => {
      const href = $(element).attr("href")
      if (href && /\/entertainment\/.*~[a-f0-9]+\/?$/i.test(href)) {
        urls.push(new URL(href, pageUrl).href)
      }
    })
  }
  return unique(urls)
}

function parseKidsweek(html) {
  const $ = load(html)
  const data = articleFromJsonLd($)
  const authorText = $("article")
    .text()
    .match(/Door\s+Bastiaan Vroegop/i)?.[0]
  const elements = $("article").find(
    'p[class*="Intro"], p[class*="Paragraph"], h2[class*="ChapterHeader"], h3[data-testid="review-chapter-header"], p[data-testid="review-paragraph"]',
  )
  const htmlBody = elements
    .map((_, element) => $.html(element))
    .get()
    .join("\n")
  const articleData = Array.isArray(data?.author) ? data.author[0] : data?.author
  return {
    title: $("h1").first().text(),
    description: data?.description || $('meta[name="description"]').attr("content"),
    date:
      data?.datePublished || data?.dateCreated || html.match(/"datePublished"\s*:\s*"([^"]+)/)?.[1],
    modified: data?.dateModified || html.match(/"dateModified"\s*:\s*"([^"]+)/)?.[1],
    author: articleData?.name || authorText,
    image:
      typeof data?.image === "string"
        ? data.image
        : data?.image?.url || $("article figure img").first().attr("src"),
    isReview: $('p[data-testid="review-paragraph"]').length > 0,
    body: turndown.turndown(htmlBody),
  }
}

async function importKidsweek() {
  for (const url of await discoverKidsweek()) {
    try {
      const html = await (await fetchResponse(url)).text()
      const parsed = parseKidsweek(html)
      const review = parsed.isReview || /(?:game)?recensie/i.test(parsed.title)
      const item = {
        source: "Kidsweek",
        sourceUrl: canonicalUrl(url),
        folder: review ? "recensies" : "",
      }
      const written = await writeArticle({ item, parsed, sourceSlug: "kidsweek", linkUrl: url })
      if (written) report.imported.kidsweek += 1
    } catch (error) {
      report.failures.push({ source: "Kidsweek", url, reason: error.message })
    }
  }
}

function parseUnpause(html) {
  const $ = load(html)
  const data = articleFromJsonLd($, "script.rank-math-schema")
  const content = $(".elementor-widget-theme-post-content .elementor-widget-container")
    .first()
    .clone()
  const $body = load(`<body>${content.html() || ""}</body>`)
  stripRemoteImages($body)
  const author = $('meta[name="twitter:data1"]').attr("content") || data?.author?.name
  return {
    title: (data?.headline || $("h1").first().text()).replace(/\s+- Unpause$/, ""),
    description: data?.description || $('meta[name="description"]').attr("content"),
    date: data?.datePublished,
    modified: data?.dateModified,
    author,
    image:
      typeof data?.image === "string"
        ? data.image
        : data?.image?.url || $('meta[property="og:image"]').attr("content"),
    body: turndown.turndown($body("body").html() || ""),
  }
}

async function importUnpause() {
  const urls = JSON.parse(
    await fs.readFile(path.join(DATA_DIR, "unpause-publications.json"), "utf8"),
  )
  for (const url of urls) {
    try {
      const parsed = parseUnpause(await (await fetchResponse(url)).text())
      const folder = url.includes("/recensies/")
        ? "recensies"
        : url.includes("/interview/")
          ? "interviews"
          : ""
      const item = { source: "Unpause", sourceUrl: canonicalUrl(url), folder }
      const written = await writeArticle({ item, parsed, sourceSlug: "unpause", linkUrl: url })
      if (written) report.imported.unpause += 1
    } catch (error) {
      report.failures.push({ source: "Unpause", url, reason: error.message })
    }
  }
}

async function addCoverage() {
  const records = await inventory()
  const trackedSources = [
    "Gamer.nl",
    "InsideGamer",
    "Power Unlimited",
    "Laadscherm",
    "Kidsweek",
    "Unpause",
  ]
  const tracked = records.filter((record) => trackedSources.includes(record.data.source))
  const sourceCounts = Object.fromEntries(
    trackedSources.map((source) => [
      source,
      tracked.filter((record) => record.data.source === source).length,
    ]),
  )
  const gamerPuItems = JSON.parse(
    await fs.readFile(path.join(DATA_DIR, "gamer-pu-publications.json"), "utf8"),
  )
  const missingGamerPu = gamerPuItems.filter(
    (item) =>
      !records.some(
        (record) =>
          record.sourceUrl === canonicalUrl(item.sourceUrl) ||
          record.data.archiveUrl?.includes(item.fetchUrl),
      ),
  )
  report.coverage = {
    sourceCounts,
    gamerPuSelection: {
      selected: gamerPuItems.length,
      covered: gamerPuItems.length - missingGamerPu.length,
      missing: missingGamerPu.map((item) => ({ source: item.source, url: item.sourceUrl })),
    },
    validation: {
      missingPublished: tracked
        .filter((record) => !record.data.published)
        .map((record) => path.relative(ROOT, record.filename)),
      missingSourceUrl: tracked
        .filter((record) => !record.data.sourceUrl)
        .map((record) => path.relative(ROOT, record.filename)),
      shortBody: tracked
        .filter((record) => record.body.length < 100)
        .map((record) => path.relative(ROOT, record.filename)),
    },
  }
}

await normalizeLegacySources()
if (!ONLY || ONLY === "gamer-pu") await importGamerPu()
if (!ONLY || ONLY === "kidsweek") await importKidsweek()
if (!ONLY || ONLY === "unpause") await importUnpause()
await addCoverage()
if (!DRY_RUN) {
  await fs.writeFile(
    path.join(DATA_DIR, "remaining-media-import-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  )
}
console.log(JSON.stringify(report, null, 2))
