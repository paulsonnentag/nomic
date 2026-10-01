// The repo as the environment carries it: create, find, and what branching
// needs on top, clone and merge, all over handles.

import type { AutomergeUrl, DocHandle, Repo as AutomergeRepo } from "@automerge/automerge-repo"
import { fromDoc, type DocBacked, type Handle } from "./handle.js"

export type Repo = {
  create<T>(init: T): DocBacked<T>
  find<T = unknown>(url: string): Promise<Handle<T>>
  /** A new document sharing the history of `handle`'s, so the two merge cleanly. */
  clone<T>(handle: Handle<T>): DocBacked<T>
  /** Merges `from`'s changes into `into`. */
  merge<T>(into: Handle<T>, from: Handle<T>): void
}

export function wrap(repo: AutomergeRepo): Repo {
  return {
    create<T>(init: T) {
      return fromDoc(repo.create<T>(init))
    },
    async find<T>(url: string) {
      return fromDoc(await repo.find<T>(url as AutomergeUrl))
    },
    clone<T>(handle: Handle<T>) {
      return fromDoc(repo.clone(docOf(handle)))
    },
    merge<T>(into: Handle<T>, from: Handle<T>) {
      docOf(into).merge(docOf(from))
    },
  }
}

function docOf<T>(handle: Handle<T>): DocHandle<T> {
  const doc = (handle as Partial<DocBacked<T>>).doc
  if (!doc) throw new Error(`${handle.url ?? "handle"} is not backed by a document`)
  return doc
}
