import fs from "node:fs/promises"
import path from "node:path"
import { load } from "cheerio"

const ROOT = process.cwd()
const CONTENT_DIR = path.join(ROOT, "content")
const OUTPUT_PATH = path.join(ROOT, "data", "nu-candidates.json")
const CACHE_DIR = process.env.NU_DISCOVERY_CACHE_DIR
const SITE_ROOT = "https://www.nu.nl"
const CONCURRENCY = 5
const MAX_DYNAMIC_TERMS = 240
const MAX_DYNAMIC_ROUNDS = 3

const HEADERS = {
  "user-agent": "Googlebot",
  "accept-language": "nl-NL,nl;q=0.9,en;q=0.8",
}

const seedTerms = [
  "reviews",
  "recensie",
  "overzicht",
  "beste",
  "test",
  "getest",
  "interview",
  "gesprek",
  "vertelt",
  "waarom",
  "uitleg",
  "achtergrond",
  "NUcheckt",
  "games",
  "game",
  "tech",
  "technologie",
  "telefoon",
  "smartphone",
  "computer",
  "internet",
  "privacy",
  "Apple",
  "Android",
  "Nintendo",
  "PlayStation",
  "Xbox",
  "Google",
  "Samsung",
  "Microsoft",
  "Sony",
  "Facebook",
  "WhatsApp",
  "Twitter",
  "TikTok",
  "iPhone",
  "iPad",
  "Mac",
  "laptop",
  "tablet",
  "horloge",
  "televisie",
  "speaker",
  "koptelefoon",
  "camera",
  "virtual reality",
  "augmented reality",
  "kunstmatige intelligentie",
  "robot",
  "streaming",
  "Netflix",
  "Spotify",
  "YouTube",
  "Twitch",
  "Steam",
  "Pokémon",
  "Mario",
  "Zelda",
  "GTA",
  "Fortnite",
  "Minecraft",
  "corona",
]

// NU.nl's search only exposes a limited result window. These official article
// URLs were found through its historical sitemaps and keep that audit
// reproducible without downloading hundreds of monthly sitemap files on every run.
const supplementalArticleUrls = [
  "https://www.nu.nl/slimmer-leven/6327304/waarom-je-niet-altijd-naar-je-virusscanner-moet-luisteren.html",
  "https://www.nu.nl/reviews/6231901/getest-de-hogere-prijs-valt-op-bij-de-nieuwe-ipad.html",
  "https://www.nu.nl/reviews/6226623/review-de-sonos-sub-mini-is-goedkoper-maar-niet-per-se-slechter.html",
  "https://www.nu.nl/reviews/6225323/review-airpods-pro-2-zijn-ook-fijn-als-je-niet-naar-muziek-luistert.html",
  "https://www.nu.nl/reviews/6233229/games-van-de-maand-call-of-duty-gotham-knights-a-plague-tale-bayonetta-3.html",
  "https://www.nu.nl/reviews/6226636/games-van-de-maand-the-last-of-us-splatoon-3-en-monkey-island.html",
  "https://www.nu.nl/games/6220772/games-van-de-maand-saints-row-spider-man-en-cult-of-the-lamb.html",
  "https://www.nu.nl/reviews/6214978/games-van-de-maand-stray-xenoblade-chronicles-3-en-as-dusk-falls.html",
  "https://www.nu.nl/tech/6211968/review-nieuwe-macbook-air-heeft-giga-accu-2020-model-blijft-favoriet.html",
  "https://www.nu.nl/reviews/6197733/games-van-de-maand-lego-star-wars-chrono-cross-en-roguebook.html",
  "https://www.nu.nl/reviews/6191219/review-de-homepod-mini-klinkt-uitstekend-maar-werkt-matig-met-spotify.html",
  "https://www.nu.nl/reviews/6192502/games-van-de-maand-gran-turismo-7-ghostwire-tokyo-final-fantasy-en-kirby.html",
  "https://www.nu.nl/reviews/6189602/review-de-mac-studio-is-een-goedkope-versie-van-de-krachtigste-macbook.html",
  "https://www.nu.nl/reviews/6186022/review-de-steam-deck-kan-geweldig-worden-maar-is-nog-niet-af.html",
  "https://www.nu.nl/reviews/6183973/review-horizon-forbidden-west-is-de-ambitieuste-nederlandse-game-ooit.html",
  "https://www.nu.nl/tech/6185808/review-elden-ring-is-net-dark-souls-maar-dan-grootser-en-mooier.html",
  "https://www.nu.nl/reviews/6186969/games-van-de-maand-elden-ring-horizon-forbidden-west-sifu-en-destiny-2.html",
  "https://www.nu.nl/reviews/6180395/review-pokemon-legends-arceus-is-leukste-en-lelijkste-pokemon-game-in-jaren.html",
  "https://www.nu.nl/reviews/6230385/review-mario-rabbids-sparks-of-hope-is-een-erg-europese-mario-game.html",
]

const stopWords = new Set(
  `bastiaan vroegop deze dit door een het van voor zijn met naar maar over niet wordt worden heeft hebben
  hoe waarom wat waar wie welke wanneer dan ook nog wel geen meer minder veel beste nieuwe review reviews
  nu.nl kunnen kun je jouw onze hun zich uit bij op om in aan als dat die de en of te is was`.split(
    /\s+/,
  ),
)

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function fetchText(url, attempts = 4) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: HEADERS })
      if (response.ok) return response.text()
      lastError = new Error(`${response.status} ${response.statusText} for ${url}`)
      if (response.status < 500 && response.status !== 429) break
    } catch (error) {
      lastError = error
    }
    await sleep(350 * attempt)
  }
  throw lastError
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

async function markdownFiles(directory = CONTENT_DIR) {
  const files = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await markdownFiles(filename)))
    else if (entry.name.endsWith(".md")) files.push(filename)
  }
  return files
}

async function locallyReferencedArticles() {
  const articles = new Map()
  for (const filename of await markdownFiles()) {
    const markdown = await fs.readFile(filename, "utf8")
    const matches = markdown.matchAll(
      /https?:\/\/(?:www\.)?nu\.nl\/[a-z0-9-]+\/\d{7}\/[^\s)"'<>]+/gi,
    )
    for (const match of matches) {
      const url = new URL(match[0])
      url.protocol = "https:"
      url.hostname = "www.nu.nl"
      url.hash = ""
      url.search = ""
      const cleanUrl = url.href.replace(/[.,;:!?]+$/, "")
      const title = decodeURIComponent(url.pathname.split("/").at(-1) || "")
        .replace(/\.html$/, "")
        .replace(/-/g, " ")
      articles.set(cleanUrl, { title, url: cleanUrl })
    }
  }
  return [...articles.values()]
}

function initialState(html) {
  const match = html.match(/window\.__INITIAL_STATE__="([^"]+)"/)
  if (!match) throw new Error("NU.nl initial state ontbreekt")
  return JSON.parse(decodeURIComponent(match[1]))
}

function queryResult(html, query) {
  const state = initialState(html)
  const links = state.content.blocksMain
    .filter((block) => block.__typename === "LinkBlock")
    .map((block) => ({
      title: block.link?.title?.text,
      url: block.link?.target?.url,
    }))
    .filter((item) => item.title && /\/\d{7}\//.test(item.url || ""))
    .map((item) => ({ ...item, url: new URL(item.url, SITE_ROOT).href }))
  const tracker = state.content.blocksMain
    .flatMap((block) => block.trackers?.show || [])
    .find((event) => event.eventName === "site_search")
  const fields = Object.fromEntries(
    (tracker?.fields || []).map((field) => [field.key, field.value]),
  )
  return { query, total: Number(fields.results_found || links.length), links }
}

function titleTerms(title) {
  return String(title || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .match(/[a-z0-9]{4,}/g)
    ?.filter((term) => !stopWords.has(term) && !/^\d+$/.test(term))
}

async function querySearch(term) {
  const query = ["Bastiaan Vroegop", term].filter(Boolean).join(" ")
  const url = new URL("/zoeken", SITE_ROOT)
  url.searchParams.set("q", query)
  return queryResult(await fetchText(url), query)
}

function schemaArticle(html) {
  const $ = load(html)
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

async function articleRecord(item) {
  const id = item.url.match(/\/(\d{7})\//)?.[1]
  let html
  if (CACHE_DIR && id) {
    try {
      html = await fs.readFile(path.join(CACHE_DIR, `${id}.html`), "utf8")
    } catch {
      // Populate the optional cache below.
    }
  }
  html ||= await fetchText(item.url)
  if (CACHE_DIR && id) {
    await fs.mkdir(CACHE_DIR, { recursive: true })
    await fs.writeFile(path.join(CACHE_DIR, `${id}.html`), html)
  }
  const state = initialState(html)
  const schema = schemaArticle(html)
  if (!schema) throw new Error("articleBody ontbreekt")
  return {
    id,
    title: schema.headline || item.title,
    url: schema.url || item.url,
    byline: findByline(state.content.blocksMain),
    published: schema.datePublished,
    modified: schema.dateModified,
    sections: schema.articleSection || [],
    wordCount: schema.wordCount,
    description: load(html)('meta[name="description"]').attr("content"),
  }
}

async function main() {
  const candidates = new Map()
  const queried = new Set()
  const queryLog = []

  async function runTerms(terms) {
    const pending = [
      ...new Set(terms.filter((term) => term !== undefined && term !== null)),
    ].filter((term) => !queried.has(term))
    for (const term of pending) queried.add(term)
    const results = await mapConcurrent(pending, CONCURRENCY, async (term) => {
      const result = await querySearch(term)
      process.stdout.write(
        `${result.query}: ${result.links.length}/${result.total} (uniek ${candidates.size})\n`,
      )
      return result
    })
    for (const result of results) {
      queryLog.push({ query: result.query, total: result.total, shown: result.links.length })
      for (const item of result.links) candidates.set(item.url, item)
    }
  }

  await runTerms(["", ...seedTerms])
  const localArticles = await locallyReferencedArticles()
  for (const item of localArticles) candidates.set(item.url, item)
  for (const url of supplementalArticleUrls) {
    const title = decodeURIComponent(new URL(url).pathname.split("/").at(-1) || "")
      .replace(/\.html$/, "")
      .replace(/-/g, " ")
    candidates.set(url, { title, url })
  }
  process.stdout.write(
    `Lokale verwijzingen en sitemapvondsten toegevoegd: ${localArticles.length} + ${supplementalArticleUrls.length} URL's, ${candidates.size} kandidaten.\n`,
  )

  for (let round = 1; round <= MAX_DYNAMIC_ROUNDS; round += 1) {
    const before = candidates.size
    const termFrequency = new Map()
    for (const item of candidates.values()) {
      for (const term of new Set(titleTerms(item.title) || [])) {
        termFrequency.set(term, (termFrequency.get(term) || 0) + 1)
      }
    }
    const dynamicTerms = [...termFrequency]
      .filter(([term, count]) => count >= 2 && !queried.has(term))
      .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
      .slice(0, MAX_DYNAMIC_TERMS)
      .map(([term]) => term)
    if (dynamicTerms.length === 0) break
    await runTerms(dynamicTerms)
    process.stdout.write(`Dynamische ronde ${round}: ${before} → ${candidates.size} kandidaten.\n`)
    if (candidates.size === before) break
  }

  process.stdout.write(`Metadata controleren voor ${candidates.size} kandidaten…\n`)
  const failures = []
  const fetchedRecords = (
    await mapConcurrent([...candidates.values()], CONCURRENCY, async (item, index) => {
      try {
        const record = await articleRecord(item)
        if ((index + 1) % 25 === 0) process.stdout.write(`${index + 1}/${candidates.size}\n`)
        return record
      } catch (error) {
        failures.push({ ...item, error: error.message })
        return undefined
      }
    })
  ).filter(Boolean)
  const records = [
    ...new Map(fetchedRecords.map((record) => [record.id || record.url, record])).values(),
  ].sort((left, right) => String(right.published).localeCompare(String(left.published)))

  const output = {
    generatedAt: new Date().toISOString(),
    searchTotal: queryLog.find((item) => item.query === "Bastiaan Vroegop")?.total,
    queries: queryLog,
    discovered: candidates.size,
    exactAuthor: records.filter((record) =>
      /^Door (?:NU\.nl\/)?Bastiaan Vroegop$/i.test(record.byline || ""),
    ).length,
    records,
    failures,
  }
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`)
  process.stdout.write(
    `Klaar: ${output.discovered} kandidaten, ${output.exactAuthor} met exacte byline, ${failures.length} fouten.\n`,
  )
}

await main()
