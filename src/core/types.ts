// The core types: environments, handles, behaviors, documents.

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

/** A document names its type, which decides the behaviors it gets. */
export type Doc = { "@patchwork": { type: string }; [key: Key]: Json }
