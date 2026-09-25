import type { DocHandle, Repo, Url } from "./types"
import { createHandle } from "./handle"

/** A repo that keeps its documents in memory. */
export function createRepo(): Repo {
  const docs = new Map<Url, DocHandle<unknown>>()
  return {
    create(doc) {
      const url: Url = `automerge:${crypto.randomUUID().replace(/-/g, "")}`
      const handle = Object.assign(createHandle(doc), { url })
      docs.set(url, handle)
      return handle
    },
    async find<T>(url: Url) {
      const handle = docs.get(url)
      if (!handle) throw new Error(`no document at ${url}`)
      return handle as DocHandle<T>
    },
  }
}
