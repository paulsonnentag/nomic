// The behavior modules the shell can load, by `behavior:` URL, and their source.

import type { Behavior } from "../runtime"

const modules = import.meta.glob<{ default: Behavior }>("./*.{ts,tsx}")
const sources = import.meta.glob<string>("./*.{ts,tsx}", { query: "?raw", import: "default" })

function pathFor(url: string): string {
  const name = url.replace(/^behavior:/, "")
  const path = Object.keys(modules).find((p) => p.replace(/^\.\//, "").replace(/\.tsx?$/, "") === name)
  if (!path) throw new Error(`no behavior at ${url}`)
  return path
}

export function importBehavior(url: string): Promise<{ default: Behavior }> {
  return modules[pathFor(url)]()
}

export function sourceOf(url: string): Promise<string> {
  return sources[pathFor(url)]()
}

export function fileOf(url: string): string {
  return pathFor(url).replace(/^\.\//, "src/behaviors/")
}
