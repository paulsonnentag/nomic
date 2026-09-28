#!/usr/bin/env node
// The nomic CLI: package management over a pushwork checkout of the packages
// folder (`pushwork init --shape patchwork-folder`, then `pushwork sync`).
// Run directly by Node ≥ 24 (type stripping).

import { Command } from "commander"
import { add, install, url } from "./commands.ts"

try {
  await main()
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

async function main() {
  const program = new Command("nomic").description("Manages the packages in a pushwork checkout")

  program
    .command("install")
    .argument("[dir]", "the directory whose packages to fill", ".")
    .description("fills the checkout paths (`/core`) in every importmap.json with the synced package urls")
    .action(async (dir: string) => {
      const changes = await install(dir)
      for (const change of changes) console.log(change)
      if (changes.length === 0) console.log("nothing to change")
    })

  program
    .command("add")
    .argument("<specs...>", "packages to add, exact versions (name@1.2.3) or bare names for the latest")
    .description("adds external packages to the current package's importmap.json")
    .action(async (specs: string[]) => {
      const map = await add(process.cwd(), specs)
      for (const spec of specs)
        console.log(`${spec} → ${map.imports?.[spec.replace(/@[^@/]+$/, "")] ?? "(see importmap.json)"}`)
    })

  program
    .command("url")
    .argument("<path>", 'a folder or package path in the checkout ("" or "." for the root)')
    .description("prints the synced document url of a folder or package")
    .action(async (path: string) => console.log(await url(process.cwd(), path)))

  await program.parseAsync(process.argv)
}
