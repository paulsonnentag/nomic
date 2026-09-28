import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { packagesOf, urlAt, withCheckout } from "./checkout.ts"
import { checkoutRootOf, findPackages, packageRootOf, posixRelative, readJson, sortKeys, writeJson } from "./lib.ts"

const DEFAULT_MODULE = "src/index.js"
const PAGE_PROVIDED = [/^solid-js(\/|$)/, /^@automerge\//]

type ImportMap = { imports?: { [key: string]: string }; scopes?: { [scope: string]: { [key: string]: string } } }

/**
 * Fills the imports of every package's importmap.json under `dir` that still
 * name a checkout path (`"core": "/core"`, `"handle": "/core/src/handle.js"`)
 * with the synced package's url, read from the checkout's documents. Returns
 * what changed.
 */
export async function install(dir: string): Promise<string[]> {
  const base = resolve(dir)
  const root = checkoutRoot(base)
  const synced = await withCheckout(root, (repo, config) => packagesOf(repo, config.rootUrl))
  const changes: string[] = []
  for (const pkg of findPackages(base)) {
    const path = join(base, pkg, "importmap.json")
    if (!existsSync(path)) continue
    const map = readJson<ImportMap>(path)
    const imports = { ...(map.imports ?? {}) }
    for (const [name, value] of Object.entries(imports)) {
      if (!value.startsWith("/")) continue // already a url
      const located = locate(synced, value.slice(1))
      if (!located)
        throw new Error(
          `${pkg || "."}/importmap.json: "${name}": ${value} is not a synced package: run \`pushwork sync\` first`,
        )
      imports[name] = `${located.url}/${located.path || DEFAULT_MODULE}`
      changes.push(`${pkg || "."}: ${name} → ${imports[name]}`)
    }
    writeJson(path, { ...map, imports: sortKeys(imports) })
  }
  return changes
}

/** Adds external packages to the current package's importmap.json through the jspm generator. */
export async function add(dir: string, specs: string[], warn = console.warn) {
  const pkg = packageRootOf(dir)
  if (!pkg) throw new Error(`${resolve(dir)} is not inside a package (no manifest.json)`)
  for (const spec of specs) {
    if (PAGE_PROVIDED.some((re) => re.test(spec))) warn(`${spec} is provided by the page; import it bare instead`)
  }
  const path = join(pkg, "importmap.json")
  const map: ImportMap = existsSync(path) ? readJson(path) : { imports: {} }
  const local = Object.fromEntries(Object.entries(map.imports ?? {}).filter(([, value]) => isLocal(value)))
  const external = Object.fromEntries(Object.entries(map.imports ?? {}).filter(([, value]) => !isLocal(value)))
  const { Generator } = await import("@jspm/generator")
  const generator = new Generator({
    mapUrl: pathToFileURL(path),
    inputMap: { imports: external, ...(map.scopes ? { scopes: map.scopes } : {}) },
    defaultProvider: "jspm.io",
    env: ["browser", "production", "module"],
    flattenScopes: false,
  })
  await generator.install(specs)
  const out = generator.getMap()
  const next: ImportMap = { imports: sortKeys({ ...(out.imports ?? {}), ...local }) }
  if (out.scopes && Object.keys(out.scopes).length) next.scopes = out.scopes
  writeJson(path, next)
  return next
}

/** The synced doc url of the folder or package at `path` (relative to `dir`) in the checkout around `dir`. */
export async function url(dir: string, path: string): Promise<string> {
  const root = checkoutRoot(dir)
  const key = posixRelative(root, resolve(dir, path))
  const found = await withCheckout(root, (repo, config) => urlAt(repo, config.rootUrl, key))
  if (!found) throw new Error(`"${key || "."}" is not a synced folder or package`)
  return found
}

/** The checkout `dir` is in; throws when there is none. */
function checkoutRoot(dir: string): string {
  const root = checkoutRootOf(dir)
  if (!root) throw new Error(`${resolve(dir)} is not inside a pushwork checkout: run \`pushwork init\` first`)
  return root
}

/** The synced package that `checkoutPath` is in, and the path of the file inside it. */
function locate(packages: Map<string, string>, checkoutPath: string): { url: string; path: string } | undefined {
  const paths = [...packages.keys()].filter(Boolean).sort((a, b) => b.length - a.length)
  const found = paths.find((pkg) => checkoutPath === pkg || checkoutPath.startsWith(`${pkg}/`))
  return found === undefined ? undefined : { url: packages.get(found)!, path: checkoutPath.slice(found.length + 1) }
}

/** Whether an importmap value names a synced package (or one still to be installed) rather than an external url. */
function isLocal(value: string): boolean {
  return value.startsWith("/") || value.startsWith("automerge:")
}

function log(message: string) {
  console.log(message)
}
