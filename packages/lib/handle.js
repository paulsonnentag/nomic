// Handles as behaviors build them: a plain value, or a field of another
// handle. The site's `Handle` shape: `{ value, url?, change, subscribe }`.

/** A handle on a plain value. `change` replaces the value when `fn` returns one, else keeps the mutated one. */
export function createHandle(initial) {
  let value = initial
  const subscribers = new Set()
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

/**
 * A handle on `root.value[...path]`. Its url is the root's with the path
 * appended, so a view of it forks under a stable name. Writes go through the
 * root; `fn` gets the field to mutate, or returns a replacement.
 */
export function field(root, ...path) {
  const name = path.join("/")
  const last = path[path.length - 1]
  return {
    get url() {
      return root.url ? `${root.url}/${name}` : undefined
    },
    get value() {
      return walk(root.value, path)
    },
    change(fn) {
      root.change((value) => {
        const parent = walk(value, path.slice(0, -1))
        if (parent === null || typeof parent !== "object") throw new Error(`nothing at "${name}"`)
        const next = fn(parent[last])
        if (next !== undefined) parent[last] = next
      })
    },
    subscribe(fn) {
      return root.subscribe((value) => {
        const found = walk(value, path)
        if (found !== undefined) fn(found)
      })
    },
  }
}

/** Replaces the contents of the object in `handle` in place, so its identity holds and readers of it are not rerun. */
export function assign(handle, next) {
  handle.change((value) => {
    for (const key of Object.keys(value)) if (!(key in next)) delete value[key]
    Object.assign(value, next)
  })
}

export function walk(value, path) {
  for (const step of path) {
    if (value === null || typeof value !== "object") return undefined
    value = value[step]
  }
  return value
}
