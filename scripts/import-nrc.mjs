import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { load } from "cheerio"
import TurndownService from "turndown"
import turndownPluginGfm from "turndown-plugin-gfm"
import YAML from "yaml"

const ROOT = process.cwd()
const CONTENT_DIR = path.join(ROOT, "content")
const MEDIA_DIR = path.join(CONTENT_DIR, "media", "nrc")
const FORCE = process.argv.includes("--force")
const DRY_RUN = process.argv.includes("--dry-run")
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const HEADERS = {
  // NRC includes the per-section author credit in the crawler representation.
  // We use it to distinguish Bastiaan's text from the other mediatip authors.
  "user-agent": "Googlebot",
  "accept-language": "nl-NL,nl;q=0.9,en;q=0.8",
}

const standaloneArticles = [
  {
    url: "https://www.nrc.nl/nieuws/2020/03/10/promovendus-productiviteit-lijdt-amper-onder-smartphone-a3993169",
    tags: ["Technologie"],
  },
  {
    url: "https://www.nrc.nl/nieuws/2020/11/09/spektakelstuk-met-dodelijk-saaie-helft-a4019257",
    folder: "recensies",
    noun: "recensie",
    tags: ["Games"],
  },
  {
    url: "https://www.nrc.nl/nieuws/2023/08/25/keulen-is-dit-weekend-pelgrimsoord-voor-gamers-en-gamemakers-a4172776",
    tags: ["Games"],
  },
  {
    url: "https://www.nrc.nl/nieuws/2023/12/18/de-10-beste-games-van-2023-volgens-nrc-a4184440",
    tags: ["Games"],
  },
  {
    url: "https://www.nrc.nl/nieuws/2024/01/23/nieuwe-like-a-dragon-game-balanceert-drama-en-lolligheid-precies-goed-a4187846",
    folder: "recensies",
    noun: "recensie",
    tags: ["Games"],
  },
  {
    url: "https://www.nrc.nl/nieuws/2024/02/22/in-fenomenale-game-remake-final-fantasy-vii-rebirth-dwaal-je-van-de-gebaande-paden-af-a4190948",
    folder: "recensies",
    noun: "recensie",
    tags: ["Games"],
  },
  {
    url: "https://www.nrc.nl/nieuws/2024/03/08/het-kamehameha-van-de-verlegen-striptekenaar-akira-toriyama-1955-2024-ging-de-hele-wereld-over-a4192469",
    tags: ["Games", "Cultuur"],
  },
  {
    url: "https://www.nrc.nl/nieuws/2024/03/11/zaai-planten-en-ga-op-onderzoek-uit-niets-is-voor-niets-in-memorabele-game-ultros-a4192674",
    folder: "recensies",
    noun: "recensie",
    tags: ["Games"],
  },
  {
    url: "https://www.nrc.nl/nieuws/2024/03/20/een-open-cultgame-waarin-je-avonturen-kunt-beleven-met-zelfgemaakte-vrienden-a4193660",
    folder: "recensies",
    noun: "recensie",
    tags: ["Games"],
  },
  {
    url: "https://www.nrc.nl/nieuws/2024/05/21/paper-mario-the-thousand-year-door-is-een-brutalere-game-dan-nintendo-nu-zou-maken-a4199488",
    folder: "recensies",
    noun: "recensie",
    tags: ["Games"],
  },
  {
    url: "https://www.nrc.nl/nieuws/2024/06/03/dit-zijn-de-beste-indie-games-van-het-voorjaar-a4263920",
    tags: ["Games"],
  },
  {
    url: "https://www.nrc.nl/nieuws/2024/09/05/schattige-springgame-astro-bot-is-visueel-sterk-maar-wel-een-beetje-simpel-a4864733",
    folder: "recensies",
    noun: "recensie",
    tags: ["Games"],
  },
  {
    url: "https://www.nrc.nl/nieuws/2024/10/22/nieuwe-dragon-ball-serie-is-meer-sprookjesachtig-en-minder-schreeuwerig-a4870206",
    folder: "recensies",
    noun: "recensie",
    tags: ["Games", "Cultuur"],
  },
  {
    url: "https://www.nrc.nl/nieuws/2024/11/11/in-metaphor-strijd-je-tegen-oprukkend-fascisme-in-europa-a4872640",
    folder: "recensies",
    noun: "recensie",
    tags: ["Games"],
  },
  {
    url: "https://www.nrc.nl/nieuws/2024/12/13/de-beste-10-games-van-2024-volgens-nrc-a4875771",
    tags: ["Games"],
  },
  {
    url: "https://www.nrc.nl/nieuws/2025/05/05/het-prachtige-clair-obscur-is-misschien-wel-de-meest-franse-game-ooit-gemaakt-a4892140",
    folder: "recensies",
    noun: "recensie",
    tags: ["Games"],
  },
  {
    url: "https://www.nrc.nl/nieuws/2025/06/30/nintendos-switch-2-is-meer-van-hetzelfde-in-een-mooiere-jas-a4898792",
    folder: "recensies",
    noun: "recensie",
    tags: ["Games", "Technologie"],
  },
  {
    url: "https://www.nrc.nl/nieuws/2025/09/23/topgame-hollow-knight-silksong-durft-sommige-spelers-af-te-schrikken-a4907147",
    folder: "recensies",
    noun: "recensie",
    tags: ["Games"],
  },
  {
    url: "https://www.nrc.nl/nieuws/2025/12/17/dit-zijn-de-tien-beste-games-van-2025-a4914558",
    tags: ["Games"],
  },
  {
    url: "https://www.nrc.nl/nieuws/2026/03/02/een-game-met-twee-succesformules-ineen-pokemon-en-animal-crossing-werkt-dat-a4921721",
    folder: "recensies",
    noun: "recensie",
    tags: ["Games"],
  },
]

const mediatipUrls = [
  "https://www.nrc.nl/nieuws/2024/10/04/63415318-a4867957",
  "https://www.nrc.nl/nieuws/2024/10/11/63419728-a4868732",
  "https://www.nrc.nl/nieuws/2024/11/15/64251667-a4872974",
  "https://www.nrc.nl/nieuws/2024/11/29/64520853-a4874651",
  "https://www.nrc.nl/nieuws/2025/01/24/65405671-a4880540",
  "https://www.nrc.nl/nieuws/2025/03/28/66563915-a4887715",
  "https://www.nrc.nl/nieuws/2025/04/18/67013324-a4890151",
  "https://www.nrc.nl/nieuws/2025/04/25/67013585-a4890796",
  "https://www.nrc.nl/nieuws/2025/05/09/67531723-a4892377",
  "https://www.nrc.nl/nieuws/2025/05/23/67723911-a4894149",
  "https://www.nrc.nl/nieuws/2025/06/06/mediatips-voor-het-weekend-de-nieuwe-mario-kart-en-film-van-succession-maker-over-foute-techbazen-a4895772",
  "https://www.nrc.nl/nieuws/2025/07/25/68940844-a4901085",
  "https://www.nrc.nl/nieuws/2025/08/22/69080604-a4903552",
  "https://www.nrc.nl/nieuws/2025/09/05/mediatips-voor-het-weekend-reportageserie-over-zuid-korea-en-gameklassieker-in-nieuw-jasje-a4904894",
]

const localNrcSources = new Map([
  [
    "40-jaar-pac-man.md",
    "https://www.nrc.nl/nieuws/2020/05/25/en-zo-begon-het40-jaar-pac-man-a4000681",
  ],
  [
    "de-smartphone-zit-de-spiegelreflex-op-de-hielen.md",
    "https://www.nrc.nl/nieuws/2020/01/28/de-smartphone-zit-de-spiegelreflex-op-de-hielen-a3988328",
  ],
  [
    "het-beeldscherm-van-morgen-vouw-je-op-en-rol-je-op.md",
    "https://www.nrc.nl/nieuws/2020/01/13/het-beeldscherm-van-morgen-vouw-je-op-en-rol-je-op-a3986635",
  ],
  [
    "interviews/final-fantasy-xvi-interview-naoki-yoshida.md",
    "https://www.nrc.nl/nieuws/2023/06/21/final-fantasy-wat-begon-als-een-zwanenzang-mondde-uit-in-een-van-de-invloedrijkste-gameseries-ooit-a4167773",
  ],
  [
    "interviews/oxenfree-ii-interview.md",
    "https://www.nrc.nl/nieuws/2023/07/14/met-het-vervolg-op-indie-gamehit-oxenfree-bemoeide-netflix-zich-nog-nauwelijks-a4169784",
  ],
  [
    "koffie-welnee-we-treffen-elkaar-in-virtuele-wereld-facebook-horizon.md",
    "https://www.nrc.nl/nieuws/2019/10/08/tot-straks-in-de-virtuele-wereld-facebook-horizon-a3975990",
  ],
  [
    "picomy-apple-arcade.md",
    "https://www.nrc.nl/nieuws/2019/12/10/rotterdamse-game-in-nieuwe-speelhal-apple-a3983217",
  ],
  [
    "pokemon-spelers-boos-vanwege-halvering-monsters.md",
    "https://www.nrc.nl/nieuws/2019/11/15/pokemon-spelers-boos-vanwege-halvering-monsters-a3980478",
  ],
  [
    "recensies/final-fantasy-vii-remake-review.md",
    "https://www.nrc.nl/nieuws/2020/04/07/final-fantasy-controversiele-heruitgave-van-klassieke-game-a3996099",
  ],
  [
    "recensies/final-fantasy-xvi-review.md",
    "https://www.nrc.nl/nieuws/2023/06/21/final-fantasy-wat-begon-als-een-zwanenzang-mondde-uit-in-een-van-de-invloedrijkste-gameseries-ooit-a4167773",
  ],
  [
    "recensies/review-51-worldwide-games.md",
    "https://www.nrc.nl/nieuws/2020/06/04/yahtzee-en-50-andere-klassiekers-op-switch-a4001690",
  ],
  [
    "recensies/review-avengers.md",
    "https://www.nrc.nl/nieuws/2020/09/21/in-avengers-draait-het-louter-om-actie-a4012912",
  ],
  [
    "recensies/review-beastars.md",
    "https://www.nrc.nl/nieuws/2020/04/14/netflix-schattige-dierenserie-beastars-gaat-over-seks-geweld-en-racisme-a3996717",
  ],
  [
    "recensies/review-cyber-shadow.md",
    "https://www.nrc.nl/nieuws/2021/02/03/cyber-shadow-is-een-game-voor-iedereen-die-terugverlangt-naar-een-lang-verloren-tijd-a4030383",
  ],
  [
    "recensies/review-destiny-2-beyond-light.md",
    "https://www.nrc.nl/nieuws/2020/12/02/een-game-vol-geheimen-en-mysteries-a4022230",
  ],
  [
    "recensies/review-dr-kawashimas-brain-training.md",
    "https://www.nrc.nl/nieuws/2020/01/16/brain-training-voor-switch-voelt-niet-van-deze-tijd-a3987110",
  ],
  [
    "recensies/review-hades.md",
    "https://www.nrc.nl/nieuws/2020/10/28/in-hades-is-doodgaan-juist-de-bedoeling-a4017724",
  ],
  [
    "recensies/review-half-life-alyx.md",
    "https://www.nrc.nl/nieuws/2020/04/21/half-life-alyx-is-het-beste-dat-je-in-vr-kunt-beleven-a3997285",
  ],
  [
    "recensies/review-hyrule-warriors-age-of-calamity.md",
    "https://www.nrc.nl/nieuws/2020/11/23/een-zelda-titel-in-naam-alleen-a4020992",
  ],
  [
    "recensies/review-luigis-mansion-3.md",
    "https://www.nrc.nl/nieuws/2019/10/30/luigis-mansion-3-eerder-charmant-dan-eng-a3978550",
  ],
  [
    "recensies/review-mario-3d-all-stars.md",
    "https://www.nrc.nl/nieuws/2020/10/14/drie-klassieke-mario-games-krijgen-nieuw-leven-wie-kan-zich-daar-tegen-verzetten-a4015885",
  ],
  [
    "recensies/review-mario-kart-home-circuit.md",
    "https://www.nrc.nl/nieuws/2020/10/28/scheuren-door-je-huiskamer-is-zeker-een-a-twee-keer-heel-leuk-a4017600",
  ],
  [
    "recensies/review-paper-mario-origami-king.md",
    "https://www.nrc.nl/nieuws/2020/07/16/in-paper-mario-zijn-je-grootste-vijanden-origamivouwsels-a4006136",
  ],
  [
    "recensies/review-pokemon-mystery-dungeon-rescue-team-dx.md",
    "https://www.nrc.nl/nieuws/2020/03/31/een-stroeve-remake-van-een-klassieker-a3995350",
  ],
  [
    "recensies/review-spelunky-2.md",
    "https://www.nrc.nl/nieuws/2020/09/29/spelunky-2-heel-voorzichtig-op-zoek-naar-geheimen-a4013892",
  ],
  [
    "recensies/review-super-mario-3d-world.md",
    "https://www.nrc.nl/nieuws/2021/02/10/tradionele-game-super-mario-3d-world-vooral-leuk-door-toevoeging-bowers-fury-a4031245",
  ],
  [
    "recensies/review-tony-hawks-pro-skater-remake.md",
    "https://www.nrc.nl/nieuws/2020/09/22/skateboarden-alsof-het-1999-is-a4013124",
  ],
  [
    "recensies/review-trials-of-mana.md",
    "https://www.nrc.nl/nieuws/2020/05/18/een-sprookje-met-een-90s-vibe-a3999994",
  ],
  [
    "recensies/review-watch-dogs-legion.md",
    "https://www.nrc.nl/nieuws/2020/11/04/hackersgame-wil-niemand-voor-de-schenen-schoppen-a4018559",
  ],
  [
    "recensies/review-world-of-warcraft-shadowlands.md",
    "https://www.nrc.nl/nieuws/2020/12/16/met-shadowlands-is-world-of-warcraft-eindelijk-weer-toegankelijk-voor-beginners-a4024050",
  ],
  [
    "recensies/review-xbox-series.md",
    "https://www.nrc.nl/nieuws/2020/11/16/gedurfde-software-conservatieve-hardware-a4020204",
  ],
  [
    "recensies/review-xenoblade-chronicles-definitive-edition.md",
    "https://www.nrc.nl/nieuws/2020/07/02/xenoblade-chronicles-definitive-edition-is-religieus-en-intiem-a4004786",
  ],
  [
    "recensies/ring-fit-adventure-review.md",
    "https://www.nrc.nl/nieuws/2019/10/21/ring-fit-adventure-geeft-gamers-een-smoes-om-te-sporten-a3977495",
  ],
  [
    "recensies/super-mario-wonder-review.md",
    "https://www.nrc.nl/nieuws/2023/10/18/inventief-super-mario-wonder-is-leuk-voor-ouder-en-kind-a4177698",
  ],
  [
    "recensies/zelda-tears-of-the-kingdom-review.md",
    "https://www.nrc.nl/nieuws/2023/05/11/nieuwe-zelda-game-doet-het-bijna-onmogelijke-de-speler-alle-vrijheid-geven-a4164439",
  ],
])

const { gfm } = turndownPluginGfm
const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "_",
  strongDelimiter: "**",
})
turndown.use(gfm)
turndown.addRule("nrcEmbed", {
  filter: ["dmt-youtube", "dmt-vimeo", "dmt-soundcloud"],
  replacement(content, node) {
    const href = node.querySelector("a")?.getAttribute("href")
    return href ? `\n\n[Bekijk ingesloten media](${href})\n\n` : content
  },
})

function cleanText(value = "") {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function cleanDescription(value = "") {
  return cleanText(value).replace(
    /^(?:games?|jaaroverzicht games|tips|technologie|necrologie[^:]*):\s*/i,
    "",
  )
}

function excerpt(value, maxLength = 300) {
  const text = cleanText(value)
  if (text.length <= maxLength) return text
  const sentences = text.match(/.*?[.!?](?=\s|$)/g) || []
  let result = ""
  for (const sentence of sentences) {
    if (result && `${result} ${sentence}`.length > maxLength) break
    result = result ? `${result} ${sentence}` : sentence
  }
  return result || `${text.slice(0, maxLength - 1).trimEnd()}…`
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/g, " en ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function slugFromUrl(url) {
  return slugify(
    new URL(url).pathname
      .split("/")
      .filter(Boolean)
      .at(-1)
      .replace(/-a\d+$/, ""),
  )
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

async function fetchPage(url) {
  const response = await fetch(url, { headers: HEADERS, redirect: "follow" })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`)
  return load(await response.text())
}

function pageSchema($) {
  const schemas = $("script[type='application/ld+json']")
    .map((_index, element) => {
      try {
        return JSON.parse($(element).html())
      } catch {
        return null
      }
    })
    .get()
    .flatMap((entry) => (Array.isArray(entry?.["@graph"]) ? entry["@graph"] : [entry]))
  return schemas.find((entry) => /NewsArticle$/.test(entry?.["@type"] || "")) || {}
}

function extensionFor(url, contentType) {
  const candidate = path.extname(new URL(url).pathname).toLowerCase()
  if (/^\.(avif|gif|jpe?g|png|svg|webp)$/.test(candidate)) return candidate
  return (
    {
      "image/avif": ".avif",
      "image/gif": ".gif",
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/svg+xml": ".svg",
      "image/webp": ".webp",
    }[contentType?.split(";")[0]] || ".img"
  )
}

async function downloadImage(urlValue, slug) {
  const url = new URL(urlValue, "https://www.nrc.nl").href
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 10)
  const destinationDir = path.join(MEDIA_DIR, slug)
  const existing = await fs.readdir(destinationDir).catch(() => [])
  const cached = existing.find((filename) => filename.startsWith(`${hash}.`))
  if (cached) return path.posix.join("media", "nrc", slug, cached)
  if (DRY_RUN) return path.posix.join("media", "nrc", slug, `${hash}.webp`)

  const response = await fetch(url, { headers: HEADERS, redirect: "follow" })
  if (!response.ok) throw new Error(`Image returned ${response.status}: ${url}`)
  const contentType = response.headers.get("content-type") || ""
  if (!contentType.startsWith("image/")) throw new Error(`Not an image (${contentType}): ${url}`)
  const declaredLength = Number(response.headers.get("content-length") || 0)
  if (declaredLength > MAX_IMAGE_BYTES) throw new Error(`Image is larger than 25 MB: ${url}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error(`Image is larger than 25 MB: ${url}`)
  const filename = `${hash}${extensionFor(response.url || url, contentType)}`
  await fs.mkdir(destinationDir, { recursive: true })
  await fs.writeFile(path.join(destinationDir, filename), buffer)
  return path.posix.join("media", "nrc", slug, filename)
}

async function fragmentToMarkdown(fragmentHtml, { slug, relativePrefix }) {
  const $ = load(`<main>${fragmentHtml}</main>`, null, false)
  $(
    "script, style, button, [data-de-article-end], .dmt-preferred-source, dmt-util-bar, .necro-data",
  ).remove()
  $("a").each((_index, element) => {
    if (/^Lees ook\b/i.test(cleanText($(element).text()))) $(element).remove()
  })
  $("dmt-rating").each((_index, element) => {
    const rating = Math.max(0, Math.min(5, Number($(element).attr("rating")) || 0))
    $(element).replaceWith(`<p>Beoordeling: ${"★".repeat(rating)}${"☆".repeat(5 - rating)}</p>`)
  })
  $("aside").each((_index, element) => {
    const text = cleanText($(element).text())
    if (
      /Dit artikel is onderdeel van het overzicht|De beste cultuur van \d{4} volgens NRC/i.test(
        text,
      )
    ) {
      $(element).remove()
      return
    }
    $(element)
      .find("h2")
      .each((_headingIndex, heading) => {
        $(heading).replaceWith(`<p><strong>${cleanText($(heading).text())}</strong></p>`)
      })
    const content = $(element).find(".dmt-article-side__text").html() || $(element).html() || ""
    $(element).replaceWith(`<blockquote><p>[!INFO] Details</p>${content}</blockquote>`)
  })
  for (const element of $("img").toArray()) {
    const src = $(element).attr("src")
    if (!src) {
      $(element).remove()
      continue
    }
    const local = await downloadImage(src, slug)
    $(element)
      .attr("src", `${relativePrefix}${local}`)
      .removeAttr("srcset")
      .removeAttr("sizes")
      .removeAttr("loading")
      .removeAttr("decoding")
      .removeAttr("width")
      .removeAttr("height")
  }
  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href")
    if (href?.startsWith("//")) $(element).attr("href", `https:${href}`)
  })
  return turndown
    .turndown($("main").html() || "")
    .replace(/\u00a0/g, " ")
    .replace(/^> \\\[!([A-Z]+)\\\]/gm, "> [!$1]")
    .replace(/^## \*\*(\d+)\\?\.\*\* /gm, "## $1. ")
    .replace(
      /^(https:\/\/(?:www\.)?youtube\.com\/watch\?v=\S+)$/gm,
      "[Bekijk ingesloten media]($1)",
    )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function articleBody($) {
  const body = $(".googlebot-article-content").first().clone()
  if (!body.length) throw new Error("NRC article body was not found")
  const end = body.find("[data-de-article-end]").first()
  if (end.length) end.nextAll().addBack().remove()
  return body
}

function wordCount(markdown) {
  return markdown
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
}

function sourceNote(noun, url, authors = []) {
  const demonstrative = noun === "recensie" ? "Deze" : "Dit"
  const collaboration = authors.length > 1 ? `, geschreven door ${authors.join(" en ")}` : ""
  return `> [!NOTE]\n> ${demonstrative} ${noun} verscheen eerder in [NRC](${url})${collaboration}.`
}

async function writeArticle(relativePath, frontmatter, markdown) {
  const destination = path.join(CONTENT_DIR, relativePath)
  if (
    !FORCE &&
    (await fs
      .access(destination)
      .then(() => true)
      .catch(() => false))
  ) {
    console.log(`overgeslagen  ${relativePath}`)
    return false
  }
  if (!DRY_RUN) {
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, `${yamlFrontmatter(frontmatter)}\n\n${markdown.trim()}\n`)
  }
  console.log(`${DRY_RUN ? "controle" : "geschreven"}    ${relativePath}`)
  return true
}

async function importStandalone(item) {
  const $ = await fetchPage(item.url)
  const schema = pageSchema($)
  const title = cleanText($("meta[property='og:title']").attr("content") || schema.headline)
  const authors = (Array.isArray(schema.author) ? schema.author : [schema.author])
    .map((author) => cleanText(author?.name))
    .filter(Boolean)
  if (!authors.includes("Bastiaan Vroegop"))
    throw new Error(`Bastiaan ontbreekt in de auteursregel: ${item.url}`)
  const slug = slugFromUrl(item.url)
  const relativePrefix = item.folder ? "../" : "./"
  const relativePath = path.posix.join(item.folder || "", `${slug}.md`)
  const body = articleBody($)
  const markdown = await fragmentToMarkdown(body.html() || "", { slug, relativePrefix })
  if (wordCount(markdown) < 150) throw new Error(`Artikeltekst lijkt onvolledig: ${item.url}`)
  const description = excerpt(
    cleanDescription($("meta[property='og:description']").attr("content") || schema.description),
  )
  const imageUrl = schema.image?.url || $("meta[property='og:image']").attr("content")
  const socialImage = imageUrl
    ? `${relativePrefix}${await downloadImage(imageUrl, slug)}`
    : undefined
  const noun = item.noun || "artikel"
  const intro = description ? `**${description}**\n\n` : ""
  await writeArticle(
    relativePath,
    {
      title,
      description,
      published: isoDate(schema.datePublished || schema.dateCreated),
      modified: isoDate(schema.dateModified),
      tags: item.tags,
      author: authors.join(" en "),
      source: "NRC",
      sourceUrl: item.url,
      socialImage,
      publish: true,
    },
    `${intro}${sourceNote(noun, item.url, authors)}\n\n${markdown}`,
  )
}

function bastiaanSection($, body) {
  const sections = []
  body.children("h2").each((_index, heading) => {
    const nodes = []
    let current = $(heading).next()
    while (current.length && !current.is("h2") && !current.is("[data-de-article-end]")) {
      nodes.push(current.get(0))
      current = current.next()
    }
    const credited = nodes.some(
      (node) => node.tagName === "p" && cleanText($(node).text()) === "Bastiaan Vroegop",
    )
    const category = cleanText(
      nodes
        .map((node) => ($(node).is("aside") ? $(node).find("h2").first().text() : ""))
        .find(Boolean),
    )
    sections.push({ heading, nodes, credited, category })
  })
  const credited = sections.filter((section) => section.credited)
  if (credited.length === 1) return credited[0]
  if (credited.length > 1)
    throw new Error(`Vond meerdere expliciet aan Bastiaan toegeschreven bijdragen`)
  const gameSections = sections.filter((section) => /^(game|games|gamen)$/i.test(section.category))
  if (gameSections.length !== 1) {
    throw new Error(`Geen auteurscredit en ${gameSections.length} herkenbare gameblokken gevonden`)
  }
  return { ...gameSections[0], inferredFromCategory: true }
}

async function importMediatip(url) {
  const $ = await fetchPage(url)
  const schema = pageSchema($)
  const authors = (Array.isArray(schema.author) ? schema.author : [schema.author])
    .map((author) => cleanText(author?.name))
    .filter(Boolean)
  if (!authors.includes("Bastiaan Vroegop"))
    throw new Error(`Bastiaan ontbreekt in de auteursregel: ${url}`)
  const body = articleBody($)
  const { heading, nodes, inferredFromCategory } = bastiaanSection($, body)
  const title = cleanText($(heading).text())
  const itemTitle = cleanText(
    nodes.map((node) => $(node).find("aside p strong").first().text()).find(Boolean),
  )
  const slug = `${slugify(itemTitle || title)}-mediatip`
  const fragment = load("<main></main>", null, false)
  for (const node of nodes) {
    const element = $(node)
    if (element.is("p") && cleanText(element.text()) === "Bastiaan Vroegop") continue
    fragment("main").append(element.clone())
  }
  const markdown = await fragmentToMarkdown(fragment("main").html() || "", {
    slug,
    relativePrefix: "./",
  })
  if (wordCount(markdown) < 75) throw new Error(`Mediatip lijkt onvolledig: ${url}`)
  const overviewTitle = cleanText($("meta[property='og:title']").attr("content") || schema.headline)
  const description = excerpt(
    markdown
      .split(/\n{2,}/)
      .find((block) => block && !/^(#|>)/.test(block))
      ?.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]/g, "") || "",
  )
  const note = `> [!NOTE]\n> Deze mediatip van Bastiaan Vroegop verscheen eerder als onderdeel van [${overviewTitle}](${url}) in NRC.`
  await writeArticle(
    `${slug}.md`,
    {
      title,
      description,
      published: isoDate(schema.datePublished || schema.dateCreated),
      modified: isoDate(schema.dateModified),
      tags: ["Games"],
      author: "Bastiaan Vroegop",
      source: "NRC",
      sourceUrl: url,
      sourceArticle: overviewTitle,
      publish: true,
    },
    `${note}\n\n${markdown}`,
  )
  if (inferredFromCategory) console.log(`  ↳ gekoppeld via het unieke gameblok: ${title}`)
}

async function fixLocalMetadata() {
  for (const [relativePath, sourceUrl] of localNrcSources) {
    const filename = path.join(CONTENT_DIR, relativePath)
    let markdown = await fs.readFile(filename, "utf8")
    const linked = `[NRC Handelsblad](${sourceUrl})`
    if (/\[(?:__)?NRC Handelsblad(?:__)?\]\([^)]+\)/.test(markdown)) {
      markdown = markdown.replace(/\[(?:__)?NRC Handelsblad(?:__)?\]\([^)]+\)/, linked)
    } else if (/NRC Handelsblad(?=\.)/.test(markdown)) {
      markdown = markdown.replace(/NRC Handelsblad(?=\.)/, linked)
    } else if (
      relativePath.endsWith("review-spelunky-2.md") ||
      relativePath.endsWith("review-tony-hawks-pro-skater-remake.md")
    ) {
      const end = markdown.indexOf("\n\n", markdown.indexOf("\n---\n") + 5)
      const note = `\n\n> [!NOTE]\n> Deze review verscheen eerder in ${linked}.`
      markdown = `${markdown.slice(0, end)}${note}${markdown.slice(end)}`
    } else {
      throw new Error(`Geen NRC-bronvermelding gevonden in ${relativePath}`)
    }
    if (relativePath === "de-smartphone-zit-de-spiegelreflex-op-de-hielen.md") {
      markdown = markdown.replace("published: 2020-01-18", "published: 2020-01-28")
    }
    if (relativePath === "recensies/review-super-mario-3d-world.md") {
      markdown = markdown.replace("published: 2020-02-10", "published: 2021-02-10")
    }
    if (!DRY_RUN) await fs.writeFile(filename, markdown)
  }
  console.log(
    `${DRY_RUN ? "gecontroleerd" : "bijgewerkt"}  ${localNrcSources.size} bestaande NRC-bronvermeldingen`,
  )
}

async function pruneUnusedMedia() {
  const referenced = new Set()
  async function collectMarkdown(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) await collectMarkdown(fullPath)
      else if (entry.name.endsWith(".md")) {
        const markdown = await fs.readFile(fullPath, "utf8")
        for (const match of markdown.matchAll(
          /(?:\.\.\/|\.\/)?(media\/nrc\/[^)\s]+?\.[a-z0-9]+)/gi,
        )) {
          referenced.add(match[1])
        }
      }
    }
  }
  const files = []
  const directories = []
  async function collectMedia(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        directories.push(fullPath)
        await collectMedia(fullPath)
      } else {
        files.push(fullPath)
      }
    }
  }
  await collectMarkdown(CONTENT_DIR)
  await collectMedia(MEDIA_DIR)
  const unused = files.filter(
    (filename) => !referenced.has(path.relative(CONTENT_DIR, filename).split(path.sep).join("/")),
  )
  if (!DRY_RUN) {
    for (const filename of unused) await fs.rm(filename)
    for (const directory of directories.reverse()) await fs.rmdir(directory).catch(() => {})
  }
  console.log(
    `${DRY_RUN ? "gevonden" : "opgeruimd"}    ${unused.length} ongebruikte NRC-afbeeldingen`,
  )
}

async function main() {
  for (const item of standaloneArticles) await importStandalone(item)
  for (const url of mediatipUrls) await importMediatip(url)
  await fixLocalMetadata()
  await pruneUnusedMedia()
}

await main()
