#!/usr/bin/env node
// The nomic CLI: hosts the packages checkout in Automerge through pushwork's
// programmatic API, in this process. Run directly by Node ≥ 24 (type stripping).

import { registerHooks } from "node:module"
import { Command } from "commander"
import { add, init, install, sync, url } from "./commands.ts"

// pushwork loads a custom shape with `require(<file url>)`, which Node does not
// resolve on its own. Resolving `file:` specifiers to themselves lets that
// require go through the ESM loader, so the shape module here and the one
// pushwork sees are the same instance.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("file:")) return { url: specifier, shortCircuit: true }
    return next(specifier, context)
  },
})

try {
  await main()
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

async function main() {
  const program = new Command("nomic").description("Hosts the nomic packages checkout in Automerge")

  program
    .command("init")
    .argument("[dir]", "the packages checkout", ".")
    .description("mints a document for every folder, package and file, and writes .pushwork/")
    .action(async (dir: string) => {
      const root = await init(dir)
      console.log(`\nroot: ${root}`)
      console.log("Paste it into site/src/main.ts as PACKAGES_ROOT_URL, then run `nomic install` and `nomic sync`.")
    })

  program
    .command("sync")
    .argument("[dir]", "a directory inside the checkout", ".")
    .description("syncs the checkout with its documents and the sync server")
    .action((dir: string) => sync(dir))

  program
    .command("install")
    .argument("[dir]", "the directory whose packages to fill", ".")
    .description("fills the checkout paths (`/core`) in every importmap.json with the synced package urls")
    .action((dir: string) => {
      const changes = install(dir)
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
    .action((path: string) => console.log(url(process.cwd(), path)))

  await program.parseAsync(process.argv)
}
