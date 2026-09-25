/** A handle over a plain value. */
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

/** A Handle over an automerge DocHandle. `change` mutates in place; a returned value is ignored. */
export function fromDoc(handle) {
  return {
    url: handle.url,
    get value() {
      return handle.doc()
    },
    change(fn) {
      handle.change((doc) => {
        fn(doc)
      })
    },
    subscribe(fn) {
      const listener = ({ doc }) => fn(doc)
      handle.on("change", listener)
      fn(handle.doc())
      return () => handle.off("change", listener)
    },
  }
}

/** A handle into a path of another handle. Changes write through to the root; the value is undefined while the path is missing. */
export function field(root, ...path) {
  const name = path.join("/")
  const last = path[path.length - 1]
  return {
    get value() {
      return walk(root.value, path)
    },
    change(fn) {
      root.change((r) => {
        const parent = walk(r, path.slice(0, -1))
        if (parent === null || typeof parent !== "object") throw new Error(`nothing at "${name}"`)
        const next = fn(parent[last])
        if (next !== undefined) parent[last] = next
      })
    },
    subscribe(fn) {
      return root.subscribe((r) => {
        const value = walk(r, path)
        if (value !== undefined) fn(value)
      })
    },
  }
}

export function isHandle(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    typeof value.change === "function" &&
    typeof value.subscribe === "function"
  )
}

/** The value at `path` inside `root`; undefined if any step is missing. */
export function walk(root, path) {
  let current = root
  for (const key of path) {
    if (current === null || typeof current !== "object" || !(key in current)) return undefined
    current = current[key]
  }
  return current
}
