#!/usr/bin/env node
// The nomic CLI: dependency management for the packages checkout. `nomic add`
// puts external packages into the checkout's import map through the jspm
// generator. Syncing the checkout is pushwork's job, not this tool's. Run
// directly by Node ≥ 24 (type stripping).

import { Command } from "commander"
import { add } from "./commands.ts"

try {
  await main()
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

async function main() {
  const program = new Command("nomic").description("Manages the dependencies of the packages checkout")

  program
    .command("add")
    .argument("<specs...>", "packages to add, exact versions (name@1.2.3) or bare names for the latest")
    .description("adds external packages to the checkout's importmap.json")
    .action(async (specs: string[]) => {
      const { path, map } = await add(process.cwd(), specs)
      console.log(path)
      for (const spec of specs) console.log(`${spec} → ${map.imports?.[nameOf(spec)] ?? "(see importmap.json)"}`)
    })

  await program.parseAsync(process.argv)
}

/** The package name of a spec: `name@1.2.3` → `name`, `@scope/name@1.2.3` → `@scope/name`. */
function nameOf(spec: string): string {
  return spec.replace(/@[^@/]+$/, "")
}
