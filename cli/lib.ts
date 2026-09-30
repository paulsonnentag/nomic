import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

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

/**
 * The packages checkout `dir` is in: the nearest ancestor (inclusive) holding
 * an importmap.json, else the nearest holding a `.pushwork/` directory (a
 * checkout with no map yet). Undefined if neither.
 */
export function checkoutRootOf(dir: string): string | undefined {
  return ancestorWith(dir, "importmap.json") ?? ancestorWith(dir, ".pushwork")
}

function ancestorWith(dir: string, name: string): string | undefined {
  for (let current = resolve(dir); ; current = dirname(current)) {
    if (existsSync(join(current, name))) return current
    if (dirname(current) === current) return undefined
  }
}
