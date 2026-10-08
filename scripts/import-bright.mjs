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
const MEDIA_DIR = path.join(CONTENT_DIR, "media", "bright")
const REPORT_PATH = path.join(ROOT, "data", "bright-import-report.json")
const API_ROOT = "https://api.bright.nl/domain/300/news"
const SITE_ROOT = "https://www.bright.nl"
const AUTHOR_USER_ID = 280758
const PAGE_SIZE = 100
const CONCURRENCY = 8
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

// These migrated articles lost their author relation in Bright's database. Their
// article bodies still end with an explicit Bastiaan Vroegop byline. Results that
// merely mention or quote Bastiaan are intentionally not included here.
const migratedBylineIds = new Set([
  1127193, 1127379, 1127421, 1127486, 1127568, 1127622, 1128017, 1128530, 1128531, 1134204, 1134205,
])

const contributionSpecs = [
  {
    newsID: 1126204,
    slug: "noclip-mediatip",
    title: "NoClip",
    folder: "recensies",
    tags: ["Games", "Elders gepubliceerd", "Bright"],
    credit: /^-\s*Bastiaan Vroegop$/i,
  },
]

const report = {
  generatedAt: new Date().toISOString(),
  discovered: 0,
  existing: 0,
  imported: 0,
  contributionsImported: 0,
  updatedMetadata: 0,
  skipped: [],
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
turndown.addRule("legacyObject", {
  filter: "object",
  replacement(_content, node) {
    const src = node.getAttribute("data")
    if (!src) return ""
    return `\n\n[Bekijk ingesloten media](${src.replace("/v/", "/watch?v=")})\n\n`
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
  return value
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

function normalizeTitle(value) {
  return slugify(
    cleanText(value)
      .replace(/^game van de week:\s*/i, "")
      .replace(/^review:?\s*/i, "")
      .replace(/\s*\|.*$/, ""),
  )
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

function isoDate(value) {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString().slice(0, 10)
}

function excerpt(value, maxLength = 300) {
  const text = cleanText(value)
  if (text.length <= maxLength) return text || undefined
  const shortened = text
    .slice(0, maxLength + 1)
    .replace(/\s+\S*$/, "")
    .trim()
  return `${shortened}…`
}

function yamlFrontmatter(data) {
  const clean = Object.fromEntries(
    Object.entries(data).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  )
  return `---\n${YAML.stringify(clean, { lineWidth: 0 }).trim()}\n---`
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
    await new Promise((resolve) => setTimeout(resolve, attempt * 400))
  }
  throw lastError
}

async function fetchJson(url) {
  return (await fetchResponse(url)).json()
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

async function listMarkdown(directory = CONTENT_DIR) {
  const files = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) await listMarkdown(filename).then((nested) => files.push(...nested))
    else if (entry.name.endsWith(".md")) files.push(filename)
  }
  return files
}

function parseMarkdown(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { data: {}, body: markdown }
  return { data: YAML.parse(match[1]) || {}, body: markdown.slice(match[0].length).trim() }
}

function brightIdFromUrl(url) {
  return String(url || "").match(/bright\.nl\/(?:nieuws|videos|plusplus)\/(\d+)\//i)?.[1]
}

function isBrightSourceNote(markdown, id) {
  const escaped = String(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(
    `>[^\\n]*(?:verscheen eerder|eerder gepubliceerd)[^\\n]*Bright[^\\n]*\\/${escaped}\\/`,
    "i",
  ).test(markdown.replace(/\n>\s*/g, " "))
}

async function existingInventory() {
  const records = []
  for (const filename of await listMarkdown()) {
    const markdown = await fs.readFile(filename, "utf8")
    const { data, body } = parseMarkdown(markdown)
    const ids = new Set()
    const sourceId = brightIdFromUrl(data.sourceUrl)
    if (sourceId && String(data.source || "").toLowerCase() === "bright") ids.add(sourceId)
    for (const match of markdown.matchAll(/https?:\/\/(?:www\.)?bright\.nl\/[^\s)>]+/gi)) {
      const id = brightIdFromUrl(match[0])
      if (id && isBrightSourceNote(markdown, id)) ids.add(id)
    }
    records.push({
      filename,
      relativePath: path.relative(CONTENT_DIR, filename).split(path.sep).join("/"),
      markdown,
      data,
      body,
      ids,
      normalizedTitle: normalizeTitle(data.title),
    })
  }
  return records
}

async function fetchArticleSummaries() {
  const items = []
  for (let page = 1; ; page += 1) {
    const parameters = new URLSearchParams({
      authorUserID: String(AUTHOR_USER_ID),
      newsStatus: "published",
      scope: "public",
      page: String(page),
      perPage: String(PAGE_SIZE),
      checkNextPage: "true",
    })
    const payload = await fetchJson(`${API_ROOT}?${parameters}`)
    items.push(...(payload.data || []))
    process.stdout.write(
      `\rBright-inventaris: ${items.length} publicaties op ${page} pagina${page === 1 ? "" : "'s"}`,
    )
    if (!payload.pagination?.hasNextPage || !payload.data?.length) break
  }
  process.stdout.write("\n")

  for (const newsID of migratedBylineIds) {
    if (items.some((item) => item.newsID === newsID)) continue
    const detail = await fetchJson(`${API_ROOT}/${newsID}`)
    items.push({
      newsID,
      newsTitle: detail.newsTitle,
      newsSubTitle: detail.newsSubTitle,
      metaDescription: detail.metaDescription,
      newsDate: detail.newsDate,
      newsPublishDate: detail.newsPublishDate,
      path: detail.path,
      category: detail.category,
      image: detail.image,
      imageUrl: detail.imageUrl,
      userID: detail.userID,
      migratedByline: true,
    })
  }

  return [...new Map(items.map((item) => [item.newsID, item])).values()]
    .filter((article) => !isNews(article))
    .sort((left, right) => new Date(right.newsDate) - new Date(left.newsDate))
}

function isNews(article) {
  return /^nieuws$/i.test(cleanText(article.category?.name))
}

function isReview(article) {
  return (
    /review/i.test(article.category?.name || "") ||
    /^(?:game van de week|review|getest):?/i.test(cleanText(article.newsTitle))
  )
}

function isInterview(article) {
  return /^interview\s*(?:::|:|-)/i.test(cleanText(article.newsTitle))
}

function displayTitle(article) {
  return cleanText(article.newsTitle)
    .replace(/^game van de week:\s*/i, "")
    .trim()
}

function baseSlug(article) {
  const sourceSlug = String(article.path || "")
    .split("/")
    .filter(Boolean)
    .at(-1)
    ?.replace(/\.html$/, "")
  if (/^game van de week:/i.test(cleanText(article.newsTitle))) {
    return `${slugify(displayTitle(article))}-review`
  }
  return slugify(sourceSlug || displayTitle(article))
}

function routeFor(article, slug) {
  const folder = isReview(article) ? "recensies" : isInterview(article) ? "interviews" : ""
  const relativePath = path.posix.join(folder, `${slug}.md`)
  const aliases = folder
    ? [`/${slug}`, `/artikelen/${slug}`, `/artikelen/${folder}/${slug}`]
    : [`/artikelen/${slug}`]
  return { folder, relativePath, relativePrefix: folder ? "../" : "./", aliases }
}

function existingArticleFor(article, records) {
  const id = String(article.newsID)
  const exact = records.find((record) => record.ids.has(id))
  if (exact) return exact
  if (!isReview(article)) return undefined
  return records.find(
    (record) =>
      record.relativePath.startsWith("recensies/") &&
      record.normalizedTitle === normalizeTitle(article.newsTitle),
  )
}

function sourceNote(noun, sourceUrl) {
  const demonstrative = noun === "recensie" ? "Deze" : "Dit"
  return `> [!NOTE]\n> ${demonstrative} ${noun} verscheen eerder op [Bright](${sourceUrl}).`
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

function normalizeExistingSourceNote(body, article) {
  const note = sourceNote("recensie", new URL(article.path, SITE_ROOT).href)
  const sourceNotePattern = /> \[!NOTE\][\s\S]{0,200}?(?=\n\n|$)/i
  if (sourceNotePattern.test(body) && /Bright/i.test(body.match(sourceNotePattern)?.[0] || "")) {
    return body.replace(sourceNotePattern, note)
  }
  return insertSourceNote(body, note)
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

async function updateExisting(record, article) {
  const sourceUrl = new URL(article.path, SITE_ROOT).href
  const previousSourceUrl = record.data.sourceUrl
  const existingDescription = String(record.data.description || "")
    .split(/\n\s*\n/)[0]
    .replace(/^💡/, "")
    .trim()
  const tags = unique([...(record.data.tags || []), "Elders gepubliceerd", "Bright"])
  const aliases = unique([
    ...(record.data.aliases || []),
    ...(record.relativePath.startsWith("recensies/")
      ? [`/${path.basename(record.relativePath, ".md")}`]
      : []),
  ])
  const data = {
    ...record.data,
    description: excerpt(existingDescription),
    published: isoDate(article.newsPublishDate || article.newsDate) || record.data.published,
    tags,
    aliases,
    author: "Bastiaan Vroegop",
    source: "Bright",
    sourceUrl,
    ...(previousSourceUrl && !/bright\.nl/i.test(previousSourceUrl)
      ? { republishedAt: previousSourceUrl }
      : {}),
    publish: true,
  }
  const body = normalizeExistingSourceNote(record.body, article)
  if (!DRY_RUN) {
    await fs.writeFile(record.filename, `${yamlFrontmatter(data)}\n\n${body.trim()}\n`)
  }
  report.updatedMetadata += 1
  report.files.push(record.relativePath)
}

function normalizeImageUrl(value) {
  if (!value) return undefined
  return value
    .replaceAll("{WebpWidth}", String(IMAGE_WIDTH))
    .replaceAll("%7BWebpWidth%7D", String(IMAGE_WIDTH))
    .replace(/\{size\}_/g, "")
    .replace(/%7Bsize%7D_/gi, "")
}

function extensionFor(url, contentType) {
  const pathname = new URL(url).pathname
  const extension = path.extname(pathname).toLowerCase()
  if (/^\.(gif|svg)$/.test(extension)) return extension
  const type = contentType?.split(";")[0]
  if (type === "image/gif") return ".gif"
  if (type === "image/svg+xml") return ".svg"
  return ".webp"
}

async function downloadImage(urlValue, slug) {
  if (SKIP_IMAGES || !urlValue) return undefined
  let url
  try {
    url = new URL(normalizeImageUrl(urlValue), SITE_ROOT).href
  } catch {
    report.images.skipped.push({ url: urlValue, reason: "ongeldige URL" })
    return undefined
  }
  if (!/^https?:/.test(url)) return undefined

  const hash = createHash("sha1").update(url).digest("hex").slice(0, 12)
  const destinationDir = path.join(MEDIA_DIR, slug)
  await fs.mkdir(destinationDir, { recursive: true })
  const cached = (await fs.readdir(destinationDir)).find((filename) =>
    filename.startsWith(`${hash}.`),
  )
  if (cached) {
    report.images.reused += 1
    return path.posix.join("media", "bright", slug, cached)
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

  const extension = extensionFor(response.url || url, contentType)
  const destination = path.join(destinationDir, `${hash}${extension}`)
  try {
    if (extension === ".gif" || extension === ".svg") {
      await fs.writeFile(destination, input)
    } else {
      await sharp(input)
        .rotate()
        .resize({ width: IMAGE_WIDTH, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(destination)
    }
    report.images.downloaded += 1
    return path.posix.join("media", "bright", slug, path.basename(destination))
  } catch (error) {
    report.images.skipped.push({ url, reason: `afbeelding verwerken mislukt: ${error.message}` })
    return undefined
  }
}

function imageSource($, element) {
  const image = $(element)
  const direct = image.attr("src") || image.attr("data-src") || image.attr("data-lazy-src")
  if (direct && !direct.startsWith("data:")) return direct
  const srcset = image.attr("srcset") || image.attr("data-srcset")
  if (!srcset) return undefined
  return srcset
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean)
    .at(-1)
}

function trimLegacyByline($) {
  const candidates = $("p, div").toArray()
  const byline = candidates.find((element) =>
    /^Bastiaan Vroegop,?\s*(?:redacteur\s+)?Bright\.?$/i.test(cleanText($(element).text())),
  )
  if (!byline) return false
  let current = $(byline)
  while (current.length) {
    const next = current.next()
    current.remove()
    current = next
  }
  return true
}

async function htmlToMarkdown(html, { slug, relativePrefix, trimByline = false }) {
  const $ = load(`<main>${html || ""}</main>`, null, false)
  $("script, style, noscript").remove()
  $("p, h2, h3").each((_index, element) => {
    if (/^Bekijk meer$/i.test(cleanText($(element).text()))) $(element).remove()
  })
  if (trimByline && !trimLegacyByline($)) {
    throw new Error("expliciete Bastiaan Vroegop-byline niet gevonden")
  }

  await Promise.all(
    $("img")
      .toArray()
      .map(async (element) => {
        const source = imageSource($, element)
        if (!source) {
          $(element).remove()
          return
        }
        const local = await downloadImage(source, slug)
        if (!local) {
          $(element).remove()
          return
        }
        $(element)
          .attr("src", `${relativePrefix}${local}`)
          .removeAttr("srcset")
          .removeAttr("data-srcset")
          .removeAttr("data-src")
          .removeAttr("data-lazy-src")
          .removeAttr("sizes")
          .removeAttr("loading")
          .removeAttr("width")
          .removeAttr("height")
      }),
  )

  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href")
    if (!href) return
    try {
      $(element).attr("href", new URL(href, SITE_ROOT).href)
    } catch {
      // Keep unusual but valid links unchanged.
    }
  })

  return turndown
    .turndown($("main").html() || "")
    .replace(/\u00a0/g, " ")
    .replace(/\*{4}([^*\n]+)\*{4}/g, "**$1**")
    .replace(/\*\*([^*\n]+)\n\*\*/g, "**$1**\n\n")
    .replace(/^\*\*\s*$/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function descriptionFrom(article, markdown) {
  const supplied = article.metaDescription || article.newsSubTitle || article.contentShort
  if (cleanText(supplied)) return excerpt(supplied)
  const paragraph = markdown
    .split(/\n{2,}/)
    .find((block) => block.trim() && !/^(#|>|!\[|\[Bekijk ingesloten media\])/.test(block.trim()))
  return excerpt(
    paragraph
      ?.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`#>]/g, "") || "",
  )
}

function articleTags(article) {
  const tags = ["Elders gepubliceerd", "Bright"]
  if (/^game van de week:/i.test(cleanText(article.newsTitle))) tags.unshift("Games")
  if (article.category?.name === "Games") tags.unshift("Games")
  return unique(tags)
}

async function uniqueRoute(article, occupiedPaths) {
  const initialSlug = baseSlug(article)
  let slug = initialSlug
  let route = routeFor(article, slug)
  if (occupiedPaths.has(route.relativePath)) {
    slug = `${initialSlug}-bright-${article.newsID}`
    route = routeFor(article, slug)
  }
  occupiedPaths.add(route.relativePath)
  return { slug, ...route }
}

async function importArticle(summary, route) {
  const article = await fetchJson(`${API_ROOT}/${summary.newsID}`)
  if (!article?.newsID || !article.newsText) throw new Error("Bright leverde geen artikeltekst")
  const migratedByline = migratedBylineIds.has(article.newsID)
  if (!migratedByline && article.author?.fullName !== "Bastiaan Vroegop") {
    throw new Error(`onverwachte auteur: ${article.author?.fullName || "onbekend"}`)
  }

  const sourceUrl = new URL(article.path, SITE_ROOT).href
  let markdown = await htmlToMarkdown(article.newsText, {
    slug: route.slug,
    relativePrefix: route.relativePrefix,
    trimByline: migratedByline,
  })
  if (!markdown) throw new Error("lege artikeltekst na conversie")
  const description = descriptionFrom(article, markdown)
  const noun = isReview(article) ? "recensie" : "artikel"
  const lead = cleanText(article.newsSubTitle)
  if (lead && !cleanText(markdown).startsWith(lead)) markdown = `**${lead}**\n\n${markdown}`
  markdown = insertSourceNote(markdown, sourceNote(noun, sourceUrl))

  let socialImage
  const imageUrl = article.image || article.imageUrl
  if (imageUrl) {
    const local = await downloadImage(imageUrl, route.slug)
    if (local) socialImage = `${route.relativePrefix}${local}`
  }

  const frontmatter = {
    title: displayTitle(article),
    description,
    published: isoDate(article.newsPublishDate || article.newsDate),
    tags: articleTags(article),
    aliases: route.aliases,
    author: "Bastiaan Vroegop",
    source: "Bright",
    sourceUrl,
    socialImage,
    publish: true,
  }
  if (!DRY_RUN) {
    const destination = path.join(CONTENT_DIR, route.relativePath)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, `${yamlFrontmatter(frontmatter)}\n\n${markdown.trim()}\n`)
  }
  report.imported += 1
  report.files.push(route.relativePath)
}

async function importContribution(spec, occupiedPaths) {
  const relativePath = path.posix.join(spec.folder, `${spec.slug}.md`)
  if (occupiedPaths.has(relativePath)) {
    report.existing += 1
    report.skipped.push({ newsID: spec.newsID, reason: "bijdrage al aanwezig" })
    return
  }

  const article = await fetchJson(`${API_ROOT}/${spec.newsID}`)
  const sourceUrl = new URL(article.path, SITE_ROOT).href
  const $ = load(`<main>${article.newsText || ""}</main>`, null, false)
  const credit = $("p")
    .toArray()
    .find((element) => spec.credit.test(cleanText($(element).text())))
  if (!credit) throw new Error(`auteurscredit ontbreekt in coproductie ${spec.newsID}`)
  const text = $(credit).prevAll("p").first()
  const heading = text.prevAll("p").first()
  if (!text.length || !heading.length) {
    throw new Error(`tekstblok ontbreekt in coproductie ${spec.newsID}`)
  }

  const fragment = load("<main></main>", null, false)
  fragment("main").append(heading.clone(), text.clone())
  const markdown = await htmlToMarkdown(fragment("main").html() || "", {
    slug: spec.slug,
    relativePrefix: "../",
  })
  const note = `> [!NOTE]\n> Deze mediatip verscheen eerder als onderdeel van [${cleanText(article.newsTitle)}](${sourceUrl}) op Bright.`
  let socialImage
  const imageUrl = article.image || article.imageUrl
  if (imageUrl) {
    const local = await downloadImage(imageUrl, spec.slug)
    if (local) socialImage = `../${local}`
  }
  const frontmatter = {
    title: spec.title,
    description: excerpt(cleanText(text.html())),
    published: isoDate(article.newsPublishDate || article.newsDate),
    tags: spec.tags,
    aliases: [`/${spec.slug}`, `/artikelen/${spec.slug}`, `/artikelen/${spec.folder}/${spec.slug}`],
    author: "Bastiaan Vroegop",
    source: "Bright",
    sourceUrl,
    sourceArticle: cleanText(article.newsTitle),
    socialImage,
    publish: true,
  }
  if (!DRY_RUN) {
    const destination = path.join(CONTENT_DIR, relativePath)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(
      destination,
      `${yamlFrontmatter(frontmatter)}\n\n${note}\n\n${markdown.trim()}\n`,
    )
  }
  occupiedPaths.add(relativePath)
  report.contributionsImported += 1
  report.files.push(relativePath)
}

async function writeReport() {
  if (DRY_RUN) return
  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true })
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
}

async function main() {
  const [records, summaries] = await Promise.all([existingInventory(), fetchArticleSummaries()])
  report.discovered = summaries.length + contributionSpecs.length
  const occupiedPaths = new Set(records.map((record) => record.relativePath))
  const pending = []

  for (const summary of summaries) {
    const existing = existingArticleFor(summary, records)
    if (existing && !FORCE) {
      report.existing += 1
      if (isReview(summary)) await updateExisting(existing, summary)
      else report.skipped.push({ newsID: summary.newsID, reason: "al aanwezig" })
      continue
    }
    const route = existing
      ? {
          slug: path.basename(existing.relativePath, ".md"),
          ...routeFor(summary, path.basename(existing.relativePath, ".md")),
          relativePath: existing.relativePath,
        }
      : await uniqueRoute(summary, occupiedPaths)
    pending.push({ summary, route })
  }

  const selected = Number.isFinite(LIMIT) ? pending.slice(0, Math.max(0, LIMIT)) : pending
  console.log(
    `${summaries.length} volledige publicaties en ${contributionSpecs.length} coproductiebijdrage gevonden; ${report.existing} al aanwezig; ${selected.length} te importeren${DRY_RUN ? " (proefrun)" : ""}.`,
  )

  let completed = 0
  await mapConcurrent(selected, CONCURRENCY, async ({ summary, route }) => {
    try {
      await importArticle(summary, route)
    } catch (error) {
      report.failures.push({
        newsID: summary.newsID,
        title: cleanText(summary.newsTitle),
        sourceUrl: new URL(summary.path, SITE_ROOT).href,
        reason: error.message,
      })
    } finally {
      completed += 1
      if (completed % 25 === 0 || completed === selected.length) {
        process.stdout.write(
          `\rVerwerkt: ${completed}/${selected.length} (geïmporteerd ${report.imported}, fouten ${report.failures.length})`,
        )
      }
    }
  })
  if (selected.length) process.stdout.write("\n")
  for (const spec of contributionSpecs) {
    try {
      await importContribution(spec, occupiedPaths)
    } catch (error) {
      report.failures.push({
        newsID: spec.newsID,
        title: spec.title,
        sourceUrl: `${API_ROOT}/${spec.newsID}`,
        reason: error.message,
      })
    }
  }
  await writeReport()

  console.log(`Geïmporteerd: ${report.imported}`)
  console.log(`Coproductiebijdragen geïmporteerd: ${report.contributionsImported}`)
  console.log(`Bestaande metadata bijgewerkt: ${report.updatedMetadata}`)
  console.log(
    `Afbeeldingen: ${report.images.downloaded} gedownload, ${report.images.reused} hergebruikt, ${report.images.skipped.length} overgeslagen`,
  )
  if (report.failures.length) {
    console.error(`${report.failures.length} artikelen konden niet worden geïmporteerd.`)
    process.exitCode = 1
  }
}

await main()
