import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { init as pushworkInit, sync as pushworkSync } from "pushwork"
import type { PushworkConfig } from "pushwork"
import { recorded } from "./shape.js"
import {
  checkoutRootOf,
  findPackages,
  packageRootOf,
  posixRelative,
  readJson,
  sidecarPath,
  sortKeys,
  writeJson,
  type Sidecar,
} from "./lib.ts"

/** The shape module, by the absolute path pushwork persists in `.pushwork/config.json`. */
export const SHAPE_PATH = fileURLToPath(new URL("./shape.js", import.meta.url))

const DEFAULT_MODULE = "src/index.js"
const PAGE_PROVIDED = [/^solid-js(\/|$)/, /^@automerge\//]

type ImportMap = { imports?: { [key: string]: string }; scopes?: { [scope: string]: { [key: string]: string } } }

/** Mints every doc for the checkout at `dir`, writes the sidecar, and returns the root url. */
export async function init(dir: string, report = log, warn = console.warn): Promise<string> {
  const root = resolve(dir)
  const { url, files } = await pushworkInit(
    { dir: root, backend: "subduction", shape: SHAPE_PATH, artifactDirectories: [] },
    report,
    warn,
  )
  writeSidecar(root, warn)
  report(`${files} files in ${url}`)
  return url
}

/** Syncs the checkout at `dir` (re-pointing pushwork at this CLI's shape module if it moved) and writes the sidecar. */
export async function sync(dir: string, report = log, warn = console.warn) {
  const root = checkoutRootOf(dir)
  if (!root) throw new Error(`${resolve(dir)} is not inside a nomic checkout: run \`nomic init\` first`)
  const configPath = join(root, ".pushwork", "config.json")
  const config = readJson<PushworkConfig>(configPath)
  if (config.shape !== SHAPE_PATH) {
    writeJson(configPath, { ...config, shape: SHAPE_PATH })
    report(`shape: ${config.shape} → ${SHAPE_PATH}`)
  }
  await pushworkSync(root, {}, report, warn)
  writeSidecar(root, warn)
}

/**
 * Fills every `/…` entry of every package's importmap.json under `dir` from the
 * sidecar, keeping the module path an entry already names. Returns what changed.
 */
export function install(dir: string): string[] {
  const base = resolve(dir)
  const root = checkoutRootOf(base)
  if (!root || !existsSync(sidecarPath(root))) {
    throw new Error(`no ${sidecarPath(root ?? base)}: run \`nomic init\` or \`nomic sync\` first`)
  }
  const sidecar = readJson<Sidecar>(sidecarPath(root))
  const changes: string[] = []
  for (const pkg of findPackages(base)) {
    const path = join(base, pkg, "importmap.json")
    if (!existsSync(path)) continue
    const map = readJson<ImportMap>(path)
    const imports = { ...(map.imports ?? {}) }
    for (const [key, value] of Object.entries(imports)) {
      if (!key.startsWith("/")) continue
      const url = sidecar[key.slice(1)]
      if (!url)
        throw new Error(`${pkg || "."}/importmap.json: "${key}" is not a synced package: run \`nomic sync\` first`)
      const next = `${url}/${modulePathOf(value)}`
      if (next === value) continue
      imports[key] = next
      changes.push(`${pkg || "."}: ${key} → ${next}`)
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
  const local = Object.fromEntries(Object.entries(map.imports ?? {}).filter(([key]) => key.startsWith("/")))
  const external = Object.fromEntries(Object.entries(map.imports ?? {}).filter(([key]) => !key.startsWith("/")))
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
export function url(dir: string, path: string): string {
  const root = checkoutRootOf(dir)
  if (!root || !existsSync(sidecarPath(root))) throw new Error(`no sidecar: run \`nomic init\` or \`nomic sync\` first`)
  const sidecar = readJson<Sidecar>(sidecarPath(root))
  const key = posixRelative(root, resolve(dir, path))
  const found = sidecar[key]
  if (!found) throw new Error(`"${key || "."}" is not a synced folder or package`)
  return found
}

/** Writes what the shape recorded during the last encode/decode to `.pushwork/nomic-tree.json`. */
function writeSidecar(root: string, warn: (message: string) => void) {
  if (recorded.size === 0) warn("the shape recorded no packages; the sidecar will be empty")
  writeJson(sidecarPath(root), sortKeys(Object.fromEntries(recorded)))
}

/** The module path an importmap value already names (`automerge:X/src/a.js` → `src/a.js`), else the default. */
function modulePathOf(value: string): string {
  const match = /^automerge:[^/#]+(?:#[^/]*)?\/(.+)$/.exec(value)
  return match ? match[1] : DEFAULT_MODULE
}

function log(message: string) {
  console.log(message)
}
