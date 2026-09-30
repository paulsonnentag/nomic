import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { checkoutRootOf, readJson, sortKeys, writeJson } from "./lib.ts"

/** Bare specifiers the page's import map already provides; adding them here would shadow the page's copy. */
const PAGE_PROVIDED = [/^solid-js(\/|$)/, /^@automerge\//]

export type ImportMap = {
  imports?: { [name: string]: string }
  scopes?: { [scope: string]: { [name: string]: string } }
}

/**
 * Adds external packages to the checkout's importmap.json through the jspm
 * generator. There is one map, at the checkout root: the site injects it once
 * at boot, so a change here needs a page reload. Returns where it was written
 * and what it holds now.
 */
export async function add(
  dir: string,
  specs: string[],
  warn: (message: string) => void = console.warn,
): Promise<{ path: string; map: ImportMap }> {
  const root = checkoutRootOf(dir)
  if (!root) {
    throw new Error(`${resolve(dir)} is not inside a packages checkout (no importmap.json or .pushwork/ above it)`)
  }
  for (const spec of specs) {
    if (PAGE_PROVIDED.some((re) => re.test(spec))) warn(`${spec} is provided by the page; import it bare instead`)
  }
  const path = join(root, "importmap.json")
  const map: ImportMap = existsSync(path) ? readJson(path) : { imports: {} }
  const { Generator } = await import("@jspm/generator")
  const generator = new Generator({
    mapUrl: pathToFileURL(path),
    inputMap: { imports: map.imports ?? {}, ...(map.scopes ? { scopes: map.scopes } : {}) },
    defaultProvider: "jspm.io",
    env: ["browser", "production", "module"],
    flattenScopes: false,
  })
  await generator.install(specs)
  const out = generator.getMap()
  const next: ImportMap = { imports: sortKeys(out.imports ?? {}) }
  if (out.scopes && Object.keys(out.scopes).length) next.scopes = out.scopes
  writeJson(path, next)
  return { path, map: next }
}
