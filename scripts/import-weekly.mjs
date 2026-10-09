import { spawn } from "node:child_process"
import path from "node:path"

const ROOT = process.cwd()
const forwarded = process.argv
  .slice(2)
  .filter((argument) => ["--dry-run", "--no-images"].includes(argument))

const jobs = [
  {
    name: "Kidsweek en Unpause",
    script: "import-remaining-media.mjs",
    arguments: ["--weekly", ...forwarded],
  },
  {
    name: "NRC",
    script: "import-nrc.mjs",
    arguments: ["--weekly", ...forwarded.filter((argument) => argument !== "--no-images")],
  },
  {
    name: "Bright",
    script: "import-bright.mjs",
    arguments: ["--weekly", ...forwarded],
  },
]

function run(job) {
  return new Promise((resolve, reject) => {
    console.log(`\n=== ${job.name} ===`)
    const child = spawn(
      process.execPath,
      [path.join(ROOT, "scripts", job.script), ...job.arguments],
      {
        cwd: ROOT,
        env: process.env,
        stdio: "inherit",
      },
    )
    child.on("error", reject)
    child.on("exit", (code, signal) => {
      if (code === 0) resolve()
      else
        reject(new Error(`${job.name} stopte met ${signal ? `signaal ${signal}` : `code ${code}`}`))
    })
  })
}

for (const job of jobs) await run(job)
