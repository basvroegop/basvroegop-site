import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { load } from "cheerio"
import TurndownService from "turndown"
import turndownPluginGfm from "turndown-plugin-gfm"
import YAML from "yaml"

const ROOT = process.cwd()
const CONTENT_DIR = path.join(ROOT, "content")
const MEDIA_DIR = path.join(CONTENT_DIR, "media")
const REPORT_PATH = path.join(ROOT, "data", "import-report.json")

const GHOST_URL = "https://gamepraat.nl"
// Ghost Content API keys are public by design and are already embedded in the site HTML.
const GHOST_CONTENT_KEY = "5d770bba768da604e044bd6caf"
const ARC_FOLDER_URL = "https://arc.net/folder/F6BCC35D-2521-4B82-99D7-18820FDDCE3A"
const BRIGHT_API_URL = "https://api.bright.nl/domain/300/news/original"
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const FORCE = process.argv.includes("--force")
const BROWSER_HEADERS = {
  // DPG's privacy gate serves its public article markup to command-line clients.
  "user-agent": "curl/8.10.1",
  "accept-language": "nl-NL,nl;q=0.9,en;q=0.8",
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
    return src ? `\n\n[Bekijk ingesloten media](${src.replace("/v/", "/watch?v=")})\n\n` : ""
  },
})

const report = {
  generatedAt: new Date().toISOString(),
  ghost: { posts: 0, pages: 0 },
  arc: { found: 0, imported: 0, alreadyPresent: [], failures: [] },
  images: { downloaded: 0, reused: 0, skipped: [] },
  files: [],
}

const htmlEntities = (value = "") => load(`<body>${value}</body>`)("body").text()

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/g, " en ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

const articleCategories = [
  { tag: "review", folder: "recensies" },
  { tag: "nieuwsbrief", folder: "nieuwsbrieven" },
  { tag: "interview", folder: "interviews" },
]

function articleRoute(slug, tags = []) {
  const category = articleCategories.find(({ tag }) =>
    tags.some((candidate) => String(candidate).toLowerCase() === tag),
  )
  const remainingTags = tags.filter(
    (candidate) => !articleCategories.some(({ tag }) => String(candidate).toLowerCase() === tag),
  )
  const directory = category ? [category.folder] : []
  const aliases = category
    ? [`/${slug}`, `/artikelen/${slug}`, `/artikelen/${category.folder}/${slug}`]
    : [`/artikelen/${slug}`]

  return {
    relativePath: path.posix.join(...directory, `${slug}.md`),
    relativePrefix: category ? "../" : "./",
    tags: remainingTags.length ? remainingTags : undefined,
    aliases,
  }
}

function normalizeTitle(value) {
  return slugify(
    value
      .replace(/^game van de week:\s*/i, "")
      .replace(/^review:\s*/i, "")
      .replace(/\s*\|.*$/, "")
      .replace(/\s+is bijna remake-waardig$/i, ""),
  )
}

function canonicalUrl(value) {
  try {
    const url = new URL(value)
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

function yamlFrontmatter(data) {
  const clean = Object.fromEntries(
    Object.entries(data).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  )
  return `---\n${YAML.stringify(clean, { lineWidth: 0 }).trim()}\n---`
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      ...BROWSER_HEADERS,
      accept: "text/html,application/json;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`)
  return response.text()
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url))
}

const brightUrlCache = new Map()
const knownBrightMigrations = new Map([
  ["5383543", "https://www.bright.nl/nieuws/1134304/the-legend-of-zelda-tears-of-the-kingdom.html"],
  ["5383418", "https://www.bright.nl/nieuws/1134318/asus-rog-ally-steam-deck-handheld.html"],
])

async function resolveLegacyBrightUrl(url) {
  const oldId = url.match(/rtlnieuws\.nl\/tech\/(?:bright-reviews\/)?artikel\/(\d+)/)?.[1]
  if (!oldId) return null
  if (knownBrightMigrations.has(oldId)) return knownBrightMigrations.get(oldId)
  if (brightUrlCache.has(oldId)) return brightUrlCache.get(oldId)

  try {
    const article = await fetchJson(`${BRIGHT_API_URL}/${oldId}`)
    const liveUrl = article?.path ? new URL(article.path, "https://www.bright.nl").href : null
    brightUrlCache.set(oldId, liveUrl)
    return liveUrl
  } catch {
    brightUrlCache.set(oldId, null)
    return null
  }
}

async function migrateLegacyBrightLinks(html) {
  const $ = load(`<main>${html || ""}</main>`, null, false)
  const anchors = $("a[href]").toArray()
  await Promise.all(
    anchors.map(async (element) => {
      const href = $(element).attr("href")
      if (!href) return
      const liveUrl = await resolveLegacyBrightUrl(href)
      if (liveUrl) $(element).attr("href", liveUrl)
    }),
  )
  return $("main").html() || ""
}

function extensionFor(url, contentType) {
  const pathname = new URL(url).pathname
  const candidate = path.extname(pathname).toLowerCase()
  if (/^\.(avif|gif|jpe?g|png|svg|webp)$/.test(candidate)) return candidate
  const extensions = {
    "image/avif": ".avif",
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/svg+xml": ".svg",
    "image/webp": ".webp",
  }
  return extensions[contentType?.split(";")[0]] || ".img"
}

async function downloadImage(urlValue, source, slug) {
  let url
  try {
    url = new URL(urlValue, GHOST_URL).href
  } catch {
    report.images.skipped.push({ url: urlValue, reason: "invalid URL" })
    return null
  }

  if (!/^https?:/.test(url)) return null
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 10)
  const destinationDir = path.join(MEDIA_DIR, source, slug)
  await fs.mkdir(destinationDir, { recursive: true })

  const cachedFile = (await fs.readdir(destinationDir)).find((filename) =>
    filename.startsWith(`${hash}.`),
  )
  if (cachedFile) {
    report.images.reused += 1
    return path.posix.join("media", source, slug, cachedFile)
  }

  let response
  try {
    response = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: "follow",
    })
  } catch (error) {
    report.images.skipped.push({ url, reason: error.message })
    return null
  }
  if (!response.ok) {
    report.images.skipped.push({ url, reason: `${response.status} ${response.statusText}` })
    return null
  }

  const contentType = response.headers.get("content-type") || ""
  if (!contentType.startsWith("image/")) {
    report.images.skipped.push({ url, reason: `not an image (${contentType || "unknown"})` })
    return null
  }
  const extension = extensionFor(response.url || url, contentType)
  const filename = `${hash}${extension}`
  const destination = path.join(destinationDir, filename)
  try {
    await fs.access(destination)
    report.images.reused += 1
    return path.posix.join("media", source, slug, filename)
  } catch {
    // Continue with the download.
  }

  const declaredLength = Number(response.headers.get("content-length") || 0)
  if (declaredLength > MAX_IMAGE_BYTES) {
    report.images.skipped.push({ url, reason: `larger than ${MAX_IMAGE_BYTES} bytes` })
    return null
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > MAX_IMAGE_BYTES) {
    report.images.skipped.push({ url, reason: `larger than ${MAX_IMAGE_BYTES} bytes` })
    return null
  }
  await fs.writeFile(destination, buffer)
  report.images.downloaded += 1
  return path.posix.join("media", source, slug, filename)
}

function preprocessGhostCards($) {
  $(".kg-signup-card, form[data-members-form]").remove()
  $("script, style").remove()

  $(".kg-callout-card").each((_index, element) => {
    const text = $(element).find(".kg-callout-text").html() || $(element).html() || ""
    $(element).replaceWith(`<blockquote><p>[!NOTE]</p><p>${text}</p></blockquote>`)
  })

  $(".kg-product-card").each((_index, element) => {
    const title = $(element).find(".kg-product-card-title").text().trim()
    const rating = $(element).find(".kg-product-card-rating-active").length
    const description = $(element).find(".kg-product-card-description").html() || ""
    const header = title ? `<p><strong>${title}</strong></p>` : ""
    const stars = rating ? `<p>Beoordeling: ${"★".repeat(rating)}${"☆".repeat(5 - rating)}</p>` : ""
    $(element).replaceWith(
      `<blockquote><p>[!INFO] Details</p>${header}${stars}${description}</blockquote>`,
    )
  })

  $(".kg-toggle-card").each((_index, element) => {
    const heading = $(element).find(".kg-toggle-heading-text").text().trim()
    const content = $(element).find(".kg-toggle-content").html() || ""
    $(element).replaceWith(`${heading ? `<h3>${heading}</h3>` : ""}${content}`)
  })

  $(".kg-bookmark-card").each((_index, element) => {
    const anchor = $(element).find("a").first()
    const url = anchor.attr("href")
    const title = $(element).find(".kg-bookmark-title").text().trim() || url
    if (url) $(element).replaceWith(`<p><a href="${url}">${title}</a></p>`)
  })

  $("iframe").each((_index, element) => {
    const src = $(element).attr("src")
    if (src) $(element).replaceWith(`<p><a href="${src}">Bekijk ingesloten media</a></p>`)
    else $(element).remove()
  })
}

async function htmlToMarkdown(html, { slug, source = "gamepraat", relativePrefix = "../" } = {}) {
  const $ = load(`<main>${html || ""}</main>`, null, false)
  preprocessGhostCards($)

  const imageElements = $("img").toArray()
  for (const element of imageElements) {
    const originalUrl = $(element).attr("src")
    if (!originalUrl) continue
    const local = await downloadImage(originalUrl, source, slug)
    if (!local) {
      $(element).remove()
      continue
    }
    $(element).attr("src", `${relativePrefix}${local}`)
    $(element)
      .removeAttr("srcset")
      .removeAttr("sizes")
      .removeAttr("loading")
      .removeAttr("width")
      .removeAttr("height")
  }

  $("a").each((_index, element) => {
    const href = $(element).attr("href")
    if (!href) return
    try {
      const url = new URL(href, GHOST_URL)
      if (url.hostname === "gamepraat.nl") {
        const slug = url.pathname.replace(/^\/+|\/+$/g, "")
        if (slug) $(element).attr("href", slug === "over-mij" ? "/over-mij" : `/${slug}`)
      }
    } catch {
      // Leave unusual but valid relative links untouched.
    }
  })

  const markdown = turndown
    .turndown($("main").html() || "")
    .replace(/\u00a0/g, " ")
    .replace(/\*{4}([^*\n]+)\*{4}/g, "**$1**")
    .replace(/\*\*([^*\n]+)\n\*\*/g, "**$1**\n\n")
    .replace(/^> \\\[!([A-Z]+)\\\]/gm, "> [!$1]")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return markdown
}

function insertSourceNote(markdown, publication, url, noun = "artikel") {
  const demonstrative = noun === "recensie" ? "Deze" : "Dit"
  const note = `> [!NOTE]\n> ${demonstrative} ${noun} verscheen eerder op [${publication}](${url}).`
  const blocks = markdown.split(/\n{2,}/)
  let leadIndex = blocks.findIndex(
    (block) => block.trim() && !/^(#|>|!\[|\*\*?(?:Bron|Foto|Beeld):)/.test(block.trim()),
  )
  if (leadIndex < 0) leadIndex = 0
  blocks.splice(leadIndex + 1, 0, note)
  return blocks.join("\n\n")
}

async function writeMarkdown(relativePath, frontmatter, markdown) {
  const destination = path.join(CONTENT_DIR, relativePath)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  if (!FORCE) {
    try {
      await fs.access(destination)
      return { destination, written: false }
    } catch {
      // File does not exist yet.
    }
  }
  const body = `${yamlFrontmatter(frontmatter)}\n\n${markdown.trim()}\n`
  await fs.writeFile(destination, body)
  report.files.push(relativePath)
  return { destination, written: true }
}

async function fetchGhostCollection(type) {
  const items = []
  let page = 1
  while (true) {
    const params = new URLSearchParams({
      key: GHOST_CONTENT_KEY,
      limit: "100",
      page: String(page),
      include: "tags,authors",
      formats: "html",
    })
    const payload = await fetchJson(`${GHOST_URL}/ghost/api/content/${type}/?${params}`)
    items.push(...payload[type])
    if (!payload.meta?.pagination?.next) break
    page = payload.meta.pagination.next
  }
  return items
}

// Handmatig hernoemde artikelen blijven via hun alias herkenbaar als al geïmporteerd.
async function renamedSlugs() {
  const slugs = new Set()
  async function scan(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (filename !== MEDIA_DIR) await scan(filename)
      } else if (entry.name.endsWith(".md")) {
        const frontmatter = (await fs.readFile(filename, "utf8")).split(/^---$/m)[1] || ""
        for (const match of frontmatter.matchAll(/^\s+- \/([^/\s]+)\s*$/gm)) {
          if (match[1] !== path.basename(filename, ".md")) slugs.add(match[1])
        }
      }
    }
  }
  await scan(CONTENT_DIR)
  return slugs
}

async function importGhost() {
  const [posts, pages, renamed] = await Promise.all([
    fetchGhostCollection("posts"),
    fetchGhostCollection("pages"),
    renamedSlugs(),
  ])
  report.ghost.posts = posts.length

  const existing = {
    posts,
    titles: new Set(posts.map((post) => normalizeTitle(post.title))),
    sourceUrls: new Set(),
  }
  for (const post of posts) {
    const importedTags = post.tags?.map((tag) => tag.name).filter((tag) => !tag.startsWith("#"))
    const route = articleRoute(post.slug, importedTags)
    const migratedHtml = await migrateLegacyBrightLinks(post.html)
    const $ = load(migratedHtml, null, false)
    $("a[href]").each((_index, element) => {
      existing.sourceUrls.add(canonicalUrl($(element).attr("href")))
    })

    if (!FORCE && renamed.has(post.slug)) continue
    let markdown = await htmlToMarkdown(migratedHtml, {
      slug: post.slug,
      relativePrefix: route.relativePrefix,
    })
    // Gamepraat toont de samenvatting als lead onder de titel; neem die mee in de tekst.
    const lead = String(post.custom_excerpt || "")
      .replace(/\s+/g, " ")
      .trim()
    if (markdown && lead && !markdown.includes(lead.slice(0, 60))) {
      markdown = `**${lead}**\n\n${markdown}`
    }
    let socialImage
    if (post.feature_image) {
      const local = await downloadImage(post.feature_image, "gamepraat", post.slug)
      if (local) socialImage = `${route.relativePrefix}${local}`
    }
    await writeMarkdown(
      route.relativePath,
      {
        title: post.title,
        description: post.custom_excerpt || post.excerpt,
        published: isoDate(post.published_at),
        modified: isoDate(post.updated_at),
        tags: route.tags,
        aliases: route.aliases,
        author: post.primary_author?.name || post.authors?.[0]?.name,
        source: "Gamepraat",
        sourceUrl: post.url,
        socialImage,
        publish: true,
      },
      markdown,
    )
  }

  const wantedPages = pages.filter((page) =>
    ["over-mij", "lokalisatiegids-gold-en-silver"].includes(page.slug),
  )
  report.ghost.pages = wantedPages.length
  for (const page of wantedPages) {
    let markdown = await htmlToMarkdown(page.html, {
      slug: page.slug,
      relativePrefix: "./",
    })
    if (page.slug === "over-mij") {
      markdown = markdown
        .replace("https://spelkost.nl/?ref=gamepraat.nl", "https://spelkost.nl/")
        .replace(
          "en schrijft daarnaast dus Gamepraat, een wekelijkse nieuwsbrief",
          "en schreef daarnaast Gamepraat, een nieuwsbrief",
        )
        .replace("BlueSky", "Bluesky")
        .replace(
          "https://bsky.app/profile/vroe.gop?ref=gamepraat.nl",
          "https://bsky.app/profile/vroe.gop",
        )
    }
    let socialImage
    if (page.feature_image) {
      const local = await downloadImage(page.feature_image, "gamepraat", page.slug)
      if (local) socialImage = `./${local}`
    }
    await writeMarkdown(
      `${page.slug}.md`,
      {
        title: page.title,
        description: page.custom_excerpt || page.excerpt,
        published: isoDate(page.published_at),
        modified: isoDate(page.updated_at),
        author: page.primary_author?.name || page.authors?.[0]?.name,
        source: "Gamepraat",
        sourceUrl: page.url,
        socialImage,
        unlisted: true,
        publish: true,
      },
      markdown,
    )
  }

  return existing
}

async function readArcItems() {
  const html = await fetchText(ARC_FOLDER_URL)
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  )
  if (!match) throw new Error("Arc folder data was not found")
  const payload = JSON.parse(match[1])
  const items = []
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (!value || typeof value !== "object") return
    const tab = value.data?.tab
    if (tab?.savedURL) items.push({ title: tab.savedTitle || value.title || "", url: tab.savedURL })
    Object.values(value).forEach(visit)
  }
  visit(payload.props?.pageProps)
  return [...new Map(items.map((item) => [canonicalUrl(item.url), item])).values()]
}

function descriptionFromMarkdown(markdown) {
  const block = markdown
    .split(/\n{2,}/)
    .find((candidate) => candidate.trim() && !/^(#|>|!\[)/.test(candidate.trim()))
  return block
    ?.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .trim()
}

function sourceSlugFromUrl(urlValue, fallbackTitle) {
  const url = new URL(urlValue)
  const part = url.pathname.split("/").filter(Boolean).at(-1) || ""
  const fromPath = part.replace(/\.html$/, "").replace(/~[a-z0-9]+$/i, "")
  return slugify(fromPath || fallbackTitle)
}

async function importBright(item, oldId, existing) {
  const article = await fetchJson(`${BRIGHT_API_URL}/${oldId}`)
  if (!article?.newsID || !article.newsText)
    throw new Error(`Bright did not return article ${oldId}`)
  if (article.author?.fullName !== "Bastiaan Vroegop") {
    throw new Error(
      `Unexpected Bright author for ${oldId}: ${article.author?.fullName || "unknown"}`,
    )
  }

  const liveUrl = new URL(article.path, "https://www.bright.nl").href
  const displayTitle = htmlEntities(article.newsTitle).replace(/^Game van de week:\s*/i, "")
  if (
    existing.sourceUrls.has(canonicalUrl(item.url)) ||
    existing.sourceUrls.has(canonicalUrl(liveUrl)) ||
    existing.titles.has(normalizeTitle(displayTitle))
  ) {
    report.arc.alreadyPresent.push({ title: displayTitle, sourceUrl: liveUrl })
    return
  }

  const slug = `${slugify(displayTitle)}-review`
  const route = articleRoute(slug, ["Review", "Games", "Elders gepubliceerd", "Bright"])
  let markdown = await htmlToMarkdown(article.newsText, {
    slug,
    source: "bright",
    relativePrefix: route.relativePrefix,
  })
  markdown = insertSourceNote(markdown, "Bright", liveUrl, "recensie")
  await writeMarkdown(
    route.relativePath,
    {
      title: displayTitle,
      description: descriptionFromMarkdown(markdown),
      published: isoDate(article.newsPublishDate || article.newsDate),
      modified: isoDate(article.newsDateUpdate),
      tags: route.tags,
      aliases: route.aliases,
      author: article.author.fullName,
      source: "Bright",
      sourceUrl: liveUrl,
      originalSourceUrl: item.url,
      publish: true,
    },
    markdown,
  )
  existing.titles.add(normalizeTitle(displayTitle))
  existing.sourceUrls.add(canonicalUrl(liveUrl))
  report.arc.imported += 1
}

function jsonLdArticles($) {
  const values = []
  $('script[type="application/ld+json"]').each((_index, element) => {
    try {
      const payload = JSON.parse($(element).html())
      const entries = Array.isArray(payload) ? payload : payload["@graph"] || [payload]
      values.push(...entries.filter((entry) => entry?.headline || entry?.articleBody))
    } catch {
      // Ignore unrelated malformed structured data.
    }
  })
  return values
}

async function importAd(item, existing) {
  if (existing.sourceUrls.has(canonicalUrl(item.url))) {
    report.arc.alreadyPresent.push({ title: item.title, sourceUrl: item.url })
    return
  }
  const html = await fetchText(item.url)
  const $ = load(html)
  const schema = jsonLdArticles($).find((entry) => entry["@type"] === "NewsArticle") || {}
  const title =
    $('meta[property="og:title"]').attr("content") || schema.headline || item.title.split(" | ")[0]
  const author =
    $('meta[name="author"]').attr("content") || $('meta[property="article:author"]').attr("content")
  if (author !== "Bastiaan Vroegop") throw new Error(`Unexpected AD author: ${author || "unknown"}`)

  const container = load("<main></main>", null, false)
  $("article .text").each((_index, element) => {
    if (!["p", "h2", "h3", "blockquote"].includes(element.tagName)) return
    const text = $(element).text().trim()
    if (/^(Lees ook|Lees meer)$/i.test(text)) return false
    if (text) container("main").append($(element).clone())
  })
  let markdown = turndown
    .turndown(container("main").html() || "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  if (markdown.split(/\s+/).length < 250)
    throw new Error(`AD body looks incomplete (${markdown.length} characters)`)
  markdown = insertSourceNote(markdown, "AD", item.url)
  const slug = sourceSlugFromUrl(item.url, title)
  const route = articleRoute(slug, ["Games", "Elders gepubliceerd", "AD"])
  await writeMarkdown(
    route.relativePath,
    {
      title,
      description: $('meta[name="description"]').attr("content"),
      published: isoDate(
        $('meta[property="article:published_time"]').attr("content") || schema.datePublished,
      ),
      modified: isoDate(
        $('meta[property="article:modified_time"]').attr("content") || schema.dateModified,
      ),
      tags: route.tags,
      aliases: route.aliases,
      author,
      source: "AD",
      sourceUrl: item.url,
      publish: true,
    },
    markdown,
  )
  existing.titles.add(normalizeTitle(title))
  existing.sourceUrls.add(canonicalUrl(item.url))
  report.arc.imported += 1
}

async function importNu(item, existing) {
  if (existing.sourceUrls.has(canonicalUrl(item.url))) {
    report.arc.alreadyPresent.push({ title: item.title, sourceUrl: item.url })
    return
  }
  const html = await fetchText(item.url)
  const $ = load(html)
  const schema = jsonLdArticles($).find((entry) => entry.articleBody)
  if (!schema?.articleBody) throw new Error("NU.nl article body was not found")
  const title = schema.headline || item.title.split(" | ")[0]
  const h2 = new Set(
    $("main h2")
      .map((_index, element) => $(element).text().trim())
      .get(),
  )
  const lines = htmlEntities(schema.articleBody)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines[0] === title) lines.shift()
  const description = lines.shift()
  const markdown = insertSourceNote(
    lines.map((line) => (h2.has(line) ? `## ${line}` : line)).join("\n\n"),
    "NU.nl",
    item.url,
    "recensie",
  )
  if (markdown.split(/\s+/).length < 500) throw new Error("NU.nl article body looks incomplete")
  const slug = sourceSlugFromUrl(item.url, title)
  const route = articleRoute(slug, ["Review", "Games", "Elders gepubliceerd", "NU.nl"])
  await writeMarkdown(
    route.relativePath,
    {
      title,
      description,
      published: isoDate(schema.datePublished),
      modified: isoDate(schema.dateModified),
      tags: route.tags,
      aliases: route.aliases,
      author: "Bastiaan Vroegop",
      source: "NU.nl",
      sourceUrl: item.url,
      publish: true,
    },
    markdown,
  )
  existing.titles.add(normalizeTitle(title))
  existing.sourceUrls.add(canonicalUrl(item.url))
  report.arc.imported += 1
}

async function importArc(existing) {
  const items = await readArcItems()
  report.arc.found = items.length
  for (const item of items) {
    try {
      const oldBrightId = item.url.match(/rtlnieuws\.nl\/.*?\/artikel\/(\d+)/)?.[1]
      if (oldBrightId) {
        await importBright(item, oldBrightId, existing)
      } else if (new URL(item.url).hostname.endsWith("ad.nl")) {
        await importAd(item, existing)
      } else if (new URL(item.url).hostname.endsWith("nu.nl")) {
        await importNu(item, existing)
      } else if (existing.sourceUrls.has(canonicalUrl(item.url))) {
        report.arc.alreadyPresent.push({ title: item.title, sourceUrl: item.url })
      } else {
        throw new Error(`Unsupported publication URL: ${item.url}`)
      }
    } catch (error) {
      report.arc.failures.push({ title: item.title, url: item.url, error: error.message })
    }
  }
}

async function main() {
  await fs.mkdir(CONTENT_DIR, { recursive: true })
  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true })
  const existing = await importGhost()
  await importArc(existing)
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)

  console.log(`Imported ${report.ghost.posts} Ghost posts and ${report.ghost.pages} Ghost pages.`)
  console.log(
    `Arc: ${report.arc.found} found, ${report.arc.imported} imported, ${report.arc.alreadyPresent.length} already present, ${report.arc.failures.length} failed.`,
  )
  console.log(
    `Images: ${report.images.downloaded} downloaded, ${report.images.reused} reused, ${report.images.skipped.length} skipped.`,
  )
  if (report.arc.failures.length) {
    for (const failure of report.arc.failures) console.error(`- ${failure.title}: ${failure.error}`)
    process.exitCode = 1
  }
}

await main()
