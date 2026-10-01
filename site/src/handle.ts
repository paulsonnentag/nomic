import type { DocHandle } from "@automerge/automerge-repo"

/** A value with a change stream. Documents, fields of documents and plain values all look like this. */
export type Handle<T = unknown> = {
  readonly value: T
  /** What the handle points at: a document url, or a document url and a path for a field. Undefined for plain values. */
  readonly url?: string
  /** Mutate in place, or return the next value. */
  change(fn: (value: T) => T | void): void
  /** Calls `fn` now if there is a value, and on every change. Returns the unsubscribe. */
  subscribe(fn: (value: T) => void): () => void
}

/** A handle over an automerge document, with the document handle behind it for the repo. */
export type DocBacked<T = unknown> = Handle<T> & { readonly url: string; readonly doc: DocHandle<T> }

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
      if (next !== undefined) value = next as T
      for (const fn of [...subscribers]) fn(value)
    },
    subscribe(fn) {
      subscribers.add(fn)
      fn(value)
      return () => subscribers.delete(fn)
    },
  }
}

/** A handle over an automerge document. `change` mutates in place; a returned value is ignored. */
export function fromDoc<T>(doc: DocHandle<T>): DocBacked<T> {
  return {
    doc,
    url: doc.url,
    get value() {
      return doc.doc() as T
    },
    change(fn) {
      doc.change((d: T) => {
        fn(d)
      })
    },
    subscribe(fn) {
      const listener = ({ doc }: { doc: T }) => fn(doc)
      doc.on("change", listener as never)
      fn(doc.doc() as T)
      return () => {
        doc.off("change", listener as never)
      }
    },
  }
}

export function isHandle(value: unknown): value is Handle {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    typeof (value as Handle).change === "function" &&
    typeof (value as Handle).subscribe === "function"
  )
}

/** The value at `path` inside `root`; undefined if any step is missing. */
export function walk(root: unknown, path: string[]): unknown {
  let current: unknown = root
  for (const key of path) {
    if (current === null || typeof current !== "object" || !(key in current)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}
