import type { Handle } from "./types"

/** A handle over a plain value. */
export function createHandle<T>(initial: T): Handle<T> {
  let value = initial
  const subscribers = new Set<(value: T) => void>()
  return {
    get value() {
      return value
    },
    change(fn) {
      const next = fn(value)
      if (next !== undefined) value = next
      for (const fn of [...subscribers]) fn(value)
    },
    subscribe(fn) {
      subscribers.add(fn)
      fn(value)
      return () => subscribers.delete(fn)
    },
  }
}

/** A handle into a path of another handle. Changes write through to the root. */
export function field<T>(root: Handle<unknown>, ...path: string[]): Handle<T> {
  const name = path.join(".")
  const last = path[path.length - 1]
  return {
    get value() {
      const value = walk(root.value, path)
      if (value === MISSING) throw new Error(`nothing at "${name}"`)
      return value as T
    },
    change(fn) {
      root.change((r) => {
        const parent = walk(r, path.slice(0, -1))
        if (parent === MISSING || parent === null || typeof parent !== "object") throw new Error(`nothing at "${name}"`)
        const container = parent as { [key: string]: unknown }
        const next = fn(container[last] as T)
        if (next !== undefined) container[last] = next
      })
    },
    subscribe(fn) {
      return root.subscribe((r) => {
        const value = walk(r, path)
        if (value !== MISSING) fn(value as T)
      })
    },
  }
}

export function isHandle(value: unknown): value is Handle<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    typeof (value as Handle<unknown>).change === "function" &&
    typeof (value as Handle<unknown>).subscribe === "function"
  )
}

const MISSING = Symbol("missing")

function walk(root: unknown, path: string[]): unknown {
  let current: unknown = root
  for (const key of path) {
    if (current === null || typeof current !== "object" || !(key in current)) return MISSING
    current = (current as { [key: string]: unknown })[key]
  }
  return current
}
