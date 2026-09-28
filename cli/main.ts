#!/usr/bin/env node
// The nomic CLI: a pushwork checkout of the packages folder (`nomic init`,
// `nomic sync`) and package management over it. Uses nomic's own pushwork
// (`../pushwork`), so nothing else needs to be installed. Run directly by
// Node ≥ 24 (type stripping).

import { Command } from "commander"
import { isClosedStorageError, isTransportError } from "pushwork"
import { add, init, install, sync, url } from "./commands.ts"

quietTeardown()
try {
  await main()
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

async function main() {
  const program = new Command("nomic").description("Manages the packages in a pushwork checkout")

  program
    .command("sync")
    .argument("[dir]", "a directory in the checkout", ".")
    .description("records the checkout's files into its documents and syncs them with the server")
    .action(async (dir: string) => {
      const snapshot = await sync(dir, progress())
      if (!snapshot) return
      const state = snapshot.synced
        ? "synced"
        : snapshot.pending
          ? "pending"
          : snapshot.connected
            ? "behind"
            : "offline"
      console.log(`${state}  ${snapshot.url}`)
      console.log(`root heads    ${snapshot.localHeads.join(" ") || "(none)"}`)
      console.log(`server heads  ${snapshot.serverHeads.join(" ") || "(none)"}`)
    })

  program
    .command("init")
    .argument("[dir]", "the directory to make a checkout", ".")
    .description("makes the directory a checkout in the folder shape and publishes it")
    .action(async (dir: string) => console.log(await init(dir, progress())))

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

/** Phases go to stdout as they start; warnings to stderr. */
function progress() {
  return {
    report: (phase: string) => console.log(`${phase}…`),
    warn: (message: string) => console.warn(`warning: ${message}`),
  }
}

/** A connection dropping while the repo shuts down surfaces as a late async error; it is not a failure. */
function quietTeardown() {
  const onError = (error: unknown) => {
    if (isTransportError(error) || isClosedStorageError(error)) return
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  process.on("uncaughtException", onError)
  process.on("unhandledRejection", onError)
}
