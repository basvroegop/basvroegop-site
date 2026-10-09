import fs from "node:fs/promises"
import path from "node:path"

const ROOT = process.cwd()
const CANDIDATES_PATH = path.join(ROOT, "data", "nu-candidates.json")
const OUTPUT_PATH = path.join(ROOT, "data", "nu-publications.json")

const exactByline = /^Door (?:NU\.nl\/)?Bastiaan Vroegop$/i

const interviewIds = new Set([
  "5310806", // Skyrim-regisseur
  "5241359", // Detroit: Become Human-schrijver
  "5916804", // YouTube-topvrouw
  "6184689", // Horizon en overwerk
])

const substantiveIds = new Set([
  // Tech: service, analyse en achtergrond.
  "6311993",
  "6241871",
  "6174126",
  "6174494",
  "6139857",
  "6138433",
  "6121202",
  "5974633",
  "5852247",
  "5030603",
  "4124451",
  // Games: achtergronden, uitleg, factcheck en tips.
  "6139847",
  "6096317",
  "6069602",
  "6059653",
  "5975177",
  "5698322",
  "5229374",
  "5022251",
  "4885922",
  "4819977",
  "4808319",
  "4299645",
  // Internet: uitleg, achtergrond en praktische hulp.
  "5853063",
  "5370851",
  "5222321",
  "5182130",
  "5182019",
  "4971851",
  "4972058",
  "4512075",
  "4366210",
  // Overige inhoudelijke publicaties.
  "6248429",
  "6150649",
  "5866659",
  "5863461",
  "5828544",
  "5756883",
  "5742264",
  "5634797",
  "5159546",
  "5126222",
  "4330702",
])

const excludedSections = new Set(["slimmer-leven"])
const completeFeatureSections = new Set(["weekend", "tech-achtergrond"])

function isReview(record) {
  return (
    record.sections.includes("reviews") ||
    /^(?:review|eerste indruk):/i.test(record.title) ||
    /^apps van de week:/i.test(record.title) ||
    /^dit zijn de beste Android- en iOS-apps van de week/i.test(record.title)
  )
}

function selection(record) {
  if (!exactByline.test(record.byline || "")) {
    return { include: false, selection: "andere-auteur" }
  }
  if (/^games van de maand:/i.test(record.title)) {
    return { include: false, selection: "maandoverzicht" }
  }
  if (record.sections.some((section) => excludedSections.has(section))) {
    return { include: false, selection: "uitgesloten-rubriek" }
  }
  if (interviewIds.has(record.id)) {
    return { include: true, folder: "interviews", selection: "interview" }
  }
  if (isReview(record)) {
    return { include: true, folder: "recensies", selection: "recensie" }
  }
  if (completeFeatureSections.has(record.sections[0])) {
    return { include: true, folder: "", selection: "inhoudelijke-rubriek" }
  }
  if (substantiveIds.has(record.id)) {
    return { include: true, folder: "", selection: "substantieel" }
  }
  return { include: false, selection: "routine-nieuws" }
}

const candidates = JSON.parse(await fs.readFile(CANDIDATES_PATH, "utf8"))
const publications = candidates.records.map((record) => ({
  id: record.id,
  url: record.url,
  title: record.title,
  published: record.published?.slice(0, 10),
  wordCount: record.wordCount,
  sections: record.sections,
  byline: record.byline,
  ...selection(record),
}))

await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(publications, null, 2)}\n`)

const selected = publications.filter((record) => record.include)
const folders = Object.fromEntries(
  [...new Set(selected.map((record) => record.folder || "hoofdmap"))].map((folder) => [
    folder,
    selected.filter((record) => (record.folder || "hoofdmap") === folder).length,
  ]),
)
const reasons = Object.fromEntries(
  [...new Set(publications.map((record) => record.selection))].map((reason) => [
    reason,
    publications.filter((record) => record.selection === reason).length,
  ]),
)

process.stdout.write(
  `${publications.length} gecontroleerd; ${selected.length} geselecteerd.\n` +
    `Mappen: ${JSON.stringify(folders)}\n` +
    `Selectie: ${JSON.stringify(reasons)}\n`,
)
