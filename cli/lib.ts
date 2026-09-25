import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

/** Package paths (posix, relative to the checkout root) → headless doc urls; "" is the root. */
export type Sidecar = { [path: string]: string }

export function readJson<T = any>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8"))
}

export function writeJson(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n")
}

export function sortKeys<T extends { [key: string]: unknown }>(object: T): T {
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .map((key) => [key, object[key]]),
  ) as T
}

/** Directories under `base` that contain a manifest.json, as posix paths relative to `base`. Packages do not nest. */
export function findPackages(base: string): string[] {
  const found: string[] = []
  walk(base, "")
  return found

  function walk(dir: string, path: string) {
    if (existsSync(join(dir, "manifest.json"))) {
      found.push(path)
      return
    }
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith(".") || name === "node_modules") continue
      const child = join(dir, name)
      if (statSync(child).isDirectory()) walk(child, path ? `${path}/${name}` : name)
    }
  }
}

export function sidecarPath(root: string): string {
  return join(root, ".pushwork", "nomic-tree.json")
}

/** The nearest ancestor of `dir` (inclusive) that holds a `.pushwork/` directory; undefined if none. */
export function checkoutRootOf(dir: string): string | undefined {
  for (let current = resolve(dir); ; current = dirname(current)) {
    if (existsSync(join(current, ".pushwork"))) return current
    if (dirname(current) === current) return undefined
  }
}

/** The nearest ancestor of `dir` (inclusive) that holds a `manifest.json`; undefined if none. */
export function packageRootOf(dir: string): string | undefined {
  for (let current = resolve(dir); ; current = dirname(current)) {
    if (existsSync(join(current, "manifest.json"))) return current
    if (dirname(current) === current) return undefined
  }
}

export function posixRelative(from: string, to: string): string {
  return relative(from, to).split("\\").join("/")
}
