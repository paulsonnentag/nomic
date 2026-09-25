// The core types: environments, handles, behaviors, documents, packages.

export type Key = string
export type Id = string
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/**
 * A scope of named values. Forks see their parent's values and can shadow
 * them. Behaviors attach to an environment and put values into it; every
 * put made by a behavior is attributed to it and dropped when it detaches.
 */
export type Environment = {
  readonly parent: Environment | undefined
  readonly behaviors: readonly Behavior[]
  get<T>(key: Key, defaultValue?: T): Handle<T>
  put<T>(key: Key, value: T | Handle<T>): Handle<T>
  entries(): { [key: Key]: Handle<unknown> }
  attach(behavior: Behavior): () => void
  fork(): Environment
  destroy(): void
}

/** A live reference to a value. */
export type Handle<T> = {
  readonly value: T
  change(fn: (value: T) => T | void): void
  subscribe(fn: (value: T) => void): () => void
}

/** A function that runs against an environment and may return a teardown. */
export type Behavior = (env: Environment) => Teardown | void
export type Teardown = () => void

/** A document names its type, and may name behaviors of its own; both decide what a view of it gets. */
export type Doc = { "@patchwork": Meta; [key: Key]: Json }
export type Meta = { type: string; behaviors?: Url[] }

// -- documents in a repo --

export type Url = `automerge:${string}`

/** A handle to a document in the repo: a handle that knows its address. */
export type DocHandle<T> = Handle<T> & { readonly url: Url }

/** Just enough repo to hold and look up documents; an Automerge repo has the same shape. */
export type Repo = {
  create<T>(doc: T): DocHandle<T>
  find<T>(url: Url): Promise<DocHandle<T>>
}

/** Turns a package document into the behavior it exports. */
export type Load = (url: Url) => Promise<Behavior>

// -- packages --

/** A folder of documents, in pushwork's folder shape. `docs` is ordered. */
export type Folder = { "@patchwork": { type: "folder" }; title: string; docs: Entry[] }
export type Entry = { name: string; type: string; url: Url }

/** A package: a directory of files in pushwork's vfs shape, paths mapping to file documents. */
export type Directory = { "@patchwork": { type: "directory"; title?: string }; [path: string]: Json }
export type File = {
  "@patchwork": { type: "file" }
  name: string
  extension: string
  mimeType: string
  content: string
}
