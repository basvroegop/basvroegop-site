import fs from "node:fs/promises"
import path from "node:path"

const outputDirectory = path.join(process.cwd(), "public")

async function htmlFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await htmlFiles(entryPath)))
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(entryPath)
  }

  return files
}

let written = 0
for (const sourcePath of await htmlFiles(outputDirectory)) {
  const html = await fs.readFile(sourcePath, "utf8")
  if (!html.includes('<meta name="robots" content="noindex">')) continue

  const redirectMatch = html.match(/<meta http-equiv="refresh" content="0; url=([^\"]+)">/)
  if (!redirectMatch) continue

  const redirectUrl = redirectMatch[1]
  const trailingSlashUrl = /^(?:[a-z]+:|\/)/i.test(redirectUrl) ? redirectUrl : `../${redirectUrl}`
  const trailingSlashHtml = html
    .replace(`href="${redirectUrl}"`, `href="${trailingSlashUrl}"`)
    .replace(`content="0; url=${redirectUrl}"`, `content="0; url=${trailingSlashUrl}"`)
  const relativePath = path.relative(outputDirectory, sourcePath).replace(/\.html$/, "")
  const destinationPath = path.join(outputDirectory, relativePath, "index.html")

  await fs.mkdir(path.dirname(destinationPath), { recursive: true })
  await fs.writeFile(destinationPath, trailingSlashHtml)
  written += 1
}

console.log(`Added ${written} trailing-slash redirects.`)
