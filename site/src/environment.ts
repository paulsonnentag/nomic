// The environment: a tree of scopes holding named values, with behaviors
// attached that read those values and put new ones. See design/environment.md.

import { createHandle, isHandle, walk, type Handle } from "./handle.js"

export type Teardown = () => void
/** A behavior's function: runs against a scope, returns a teardown when it applies, nothing when it does not. */
export type Run = (env: Env) => Teardown | void

/** A behavior running in a scope, as `behaviors` describes it. */
export type Behavior = {
  url: string
  /** What the last run returned: present when the behavior applies here. */
  teardown?: Teardown
  /** The keys read during the last run; their values are `get(key).value` here. */
  reads: Record<string, boolean>
  /** What the last run threw, if it did. */
  error?: string
}

/** One candidate at a key. `url` is undefined for puts made outside a behavior. */
export type Conflict = { url: string | undefined; handle: Handle; chosen: boolean }

export type Env = {
  /** Stable across rebuilds: the parent's id and the fork's name. */
  readonly id: string
  readonly parent: Env | undefined
  readonly forks: readonly Env[]
  readonly behaviors: readonly Behavior[]

  /** A live handle on what is visible at `key` from here: bound here, else inherited from above. */
  get<T = unknown>(key: string): Handle<T>
  /** The bindings made here, key → visible handle, in put order. */
  entries(): Record<string, Handle>
  /** Every candidate at `key`, in put order, in the scope `get(key)` resolves to; empty if none. */
  conflicts(key: string): Conflict[]

  /** Binds `key` here. A plain value is wrapped in a handle; a handle is stored as is. */
  put<T>(key: string, value: T | Handle<T>): Handle<T>
  /** Makes the candidate put by `url` at `key` the visible one; `undefined` goes back to the last put. */
  choose(key: string, url: string | undefined): void

  /** Runs `run` here as the behavior at `url`, and again whenever what it read changes. Once per url per scope. */
  attach(run: Run, url: string): void
  /** Tears the behavior at `url` down and drops its puts. */
  detach(url: string): void

  /** A child scope with the id `<this id>/<name>`. */
  fork(name: string): Env
  destroy(): void
  /** Calls `fn` when the structure changes here, above or below: a put or drop, a choose, an attach or detach, a fork made or destroyed. */
  subscribe(fn: () => void): () => void

  /** The live scope with this id anywhere on the page. For the inspector, not for behaviors reaching into other views. */
  lookup(id: string): Env | undefined
}

/** A fresh root scope, id `root`. */
export function createEnvironment(): Env {
  return new Scope(undefined, "root")
}

const RERUNS = 100 // reruns of one behavior within a macrotask before it is left alone

type Binding = { candidates: Map<string | undefined, Handle>; chosen?: string }
type Attachment = { record: Behavior; stop: () => void }
type Resolved = { scope: Scope; key: string; handle: Handle; rest: string[] }

/** Every live scope on the page by id. */
const scopes = new Map<string, Scope>()

class Scope implements Env {
  readonly id: string
  readonly parent: Scope | undefined
  #bindings = new Map<string, Binding>()
  #behaviors = new Map<string, Attachment>()
  #forks = new Set<Scope>()
  #subscribers = new Set<() => void>()
  #destroyed = false

  constructor(parent: Scope | undefined, id: string) {
    this.parent = parent
    this.id = id
    scopes.set(id, this)
  }

  get forks(): Scope[] {
    return [...this.#forks]
  }

  get behaviors(): Behavior[] {
    return [...this.#behaviors.values()].map((a) => a.record)
  }

  // -- reading --

  get<T = unknown>(key: string): Handle<T> {
    return this.live<T>(key)
  }

  entries(): Record<string, Handle> {
    const out: Record<string, Handle> = {}
    for (const key of this.#bindings.keys()) out[key] = this.live(key)
    return out
  }

  conflicts(key: string): Conflict[] {
    const found = this.resolve(key)
    if (!found) return []
    const binding = found.scope.#bindings.get(found.key)!
    return [...binding.candidates].map(([url, handle]) => ({ url, handle, chosen: binding.chosen === url }))
  }

  // -- writing --

  put<T>(key: string, value: T | Handle<T>): Handle<T> {
    return this.set(key, value, undefined)
  }

  choose(key: string, url: string | undefined): void {
    const binding = this.#bindings.get(key)
    if (!binding) throw new Error(`nothing is bound at "${key}" in ${this.id}`)
    if (url !== undefined && !binding.candidates.has(url))
      throw new Error(`"${url}" put nothing at "${key}" in ${this.id}`)
    binding.chosen = url
    this.changed()
  }

  // -- behaviors --

  attach(run: Run, url: string): void {
    if (this.#destroyed) return // behaviors arrive asynchronously; the view that wanted them may be gone
    if (this.#behaviors.has(url)) throw new Error(`"${url}" is already attached to ${this.id}`)
    const attachment = attach(this, run, url)
    this.#behaviors.set(url, attachment)
    this.changed()
  }

  detach(url: string): void {
    const attachment = this.#behaviors.get(url)
    if (!attachment) return
    this.#behaviors.delete(url)
    attachment.stop()
    this.changed()
  }

  // -- structure --

  fork(name: string): Scope {
    let id = `${this.id}/${name}`
    for (let n = 2; scopes.has(id); n++) id = `${this.id}/${name}~${n}`
    const child = new Scope(this, id)
    this.#forks.add(child)
    this.changed()
    return child
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    for (const fork of [...this.#forks]) fork.destroy()
    for (const url of [...this.#behaviors.keys()].reverse()) this.detach(url)
    this.#bindings.clear()
    this.#subscribers.clear()
    if (scopes.get(this.id) === this) scopes.delete(this.id)
    if (this.parent) {
      this.parent.#forks.delete(this)
      this.parent.changed()
    }
  }

  subscribe(fn: () => void): () => void {
    this.#subscribers.add(fn)
    return () => {
      this.#subscribers.delete(fn)
    }
  }

  lookup(id: string): Env | undefined {
    return scopes.get(id)
  }

  // -- internals, shared with attachments and facades --

  /** Puts `value` at `key` as the candidate of `url`, replacing what `url` put there before. */
  set<T>(key: string, value: T | Handle<T>, url: string | undefined): Handle<T> {
    const handle = isHandle(value) ? value : createHandle(value)
    for (const bound of [...this.#bindings.keys()]) {
      if (bound !== key && covers(key, bound)) this.#bindings.delete(bound) // unreachable from now on
    }
    let binding = this.#bindings.get(key)
    if (!binding) this.#bindings.set(key, (binding = { candidates: new Map() }))
    binding.candidates.delete(url) // re-inserted last: the latest put is visible unless another is chosen
    binding.candidates.set(url, handle as Handle)
    this.changed()
    return this.live<T>(key)
  }

  /** Removes every candidate `url` put here. */
  dropAll(url: string): void {
    let any = false
    for (const [key, binding] of [...this.#bindings]) {
      if (!binding.candidates.has(url)) continue
      binding.candidates.delete(url)
      if (binding.chosen === url) binding.chosen = undefined
      if (binding.candidates.size === 0) this.#bindings.delete(key)
      any = true
    }
    if (any) this.changed()
  }

  /** The value visible at `key` from here; undefined if nothing is. */
  lookupValue(key: string): unknown {
    const found = this.resolve(key)
    if (!found) return undefined
    return found.rest.length ? walk(found.handle.value, found.rest) : found.handle.value
  }

  /** The visible handle at `key`: in the nearest scope binding `key` or a prefix of it, the longest such key's winner. */
  resolve(key: string): Resolved | undefined {
    for (let scope: Scope | undefined = this; scope; scope = scope.parent) {
      const bound = scope.match(key)
      if (bound === undefined) continue
      const handle = winner(scope.#bindings.get(bound)!)
      return { scope, key: bound, handle, rest: key.slice(bound.length).split("/").filter(Boolean) }
    }
    return undefined
  }

  /** The longest key bound here that is `key` or a prefix of it. */
  match(key: string): string | undefined {
    let best: string | undefined
    for (const bound of this.#bindings.keys()) {
      if (covers(bound, key) && (best === undefined || bound.length > best.length)) best = bound
    }
    return best
  }

  /** A live handle: it always reports what is visible at `key` from here. A `tracker` hears every `.value` read and wraps the callbacks, so reads inside them are not tracked. */
  live<T>(key: string, tracker?: Tracker): Handle<T> {
    const scope = this
    return {
      get value() {
        tracker?.read(key)
        return scope.lookupValue(key) as T
      },
      get url() {
        return scope.resolve(key)?.handle.url
      },
      change(fn) {
        const found = scope.resolve(key)
        if (!found) throw new Error(`nothing is visible at "${key}" from ${scope.id}`)
        if (found.rest.length === 0) return found.handle.change(fn as (value: unknown) => unknown)
        const last = found.rest[found.rest.length - 1]
        found.handle.change((root) => {
          const parent = walk(root, found.rest.slice(0, -1)) as Record<string, unknown> | null
          if (parent === null || typeof parent !== "object") throw new Error(`nothing at "${key}"`)
          const next = fn(parent[last] as T)
          if (next !== undefined) parent[last] = next
        })
      },
      subscribe(fn) {
        const emit = () => {
          const value = scope.lookupValue(key)
          if (value === undefined) return
          if (tracker) tracker.callback(() => fn(value as T))
          else fn(value as T)
        }
        emit()
        return scope.follow(key, emit)
      },
    }
  }

  /**
   * Calls `fn` whenever what is visible at `key` may have changed: the visible
   * candidate's value changed, or a structure change made another candidate
   * visible. Follows the candidate directly; asks the scope only for structure.
   */
  follow(key: string, fn: () => void): () => void {
    let current = this.resolve(key)?.handle
    let stop = listen(current, fn)
    const unsubscribe = this.subscribe(() => {
      const next = this.resolve(key)?.handle
      if (next === current) return
      stop()
      current = next
      stop = listen(current, fn)
      fn()
    })
    return () => {
      stop()
      unsubscribe()
    }
  }

  /** Tells the subscribers here, above and below that the structure changed. */
  changed(): void {
    for (let scope = this.parent; scope; scope = scope.parent) scope.#notify()
    this.#notifyDown()
  }

  #notifyDown(): void {
    this.#notify()
    for (const fork of this.#forks) fork.#notifyDown()
  }

  #notify(): void {
    for (const fn of [...this.#subscribers]) fn()
  }
}

/** Runs `run` in `scope` as `url`, follows what it read, and reruns it when that changes. */
function attach(scope: Scope, run: Run, url: string): Attachment {
  const record: Behavior = { url, reads: {} }
  let running = false
  let writing = false
  let detached = false
  let scheduled = false
  let burst = 0 // reruns since the last macrotask, to catch behaviors that feed each other
  let cooling: ReturnType<typeof setTimeout> | undefined
  let suspended = 0 // depth of subscribe callbacks running: reads inside them are not tracked, even during the run
  let seen = new Map<string, unknown>() // key read in the last run → the value visible after it
  let following: (() => void)[] = []

  const facade = createFacade(scope, url, {
    read: (key) => {
      if (running && suspended === 0) seen.set(key, undefined)
    },
    callback: (fn) => {
      suspended++
      try {
        return fn()
      } finally {
        suspended--
      }
    },
    guard: (fn) => {
      writing = true
      try {
        fn()
      } finally {
        writing = false
      }
    },
  })

  /** One run: the previous teardown and puts go first, so a run starts clean. */
  const execute = () => {
    for (const stop of following) stop()
    following = []
    callTeardown()
    scope.dropAll(url)
    seen = new Map()
    running = true
    let teardown: Teardown | void = undefined
    let error: unknown
    try {
      teardown = run(facade)
    } catch (e) {
      error = e
      console.error(`[environment] ${url} failed in ${scope.id}`, e)
    } finally {
      running = false
    }
    // Recorded after the run, so a behavior that shadows what it read does not rerun on its own put.
    for (const key of seen.keys()) seen.set(key, scope.lookupValue(key))
    record.teardown = typeof teardown === "function" ? teardown : undefined
    record.reads = Object.fromEntries([...seen.keys()].map((key) => [key, true]))
    if (error === undefined) delete record.error
    else record.error = String((error as Error)?.message ?? error)
    for (const key of seen.keys()) following.push(scope.follow(key, () => check(key)))
  }

  const check = (key: string) => {
    if (detached || scheduled || writing) return
    if (scope.lookupValue(key) === seen.get(key)) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      if (detached) return
      if (++burst > RERUNS) {
        console.error(`[environment] ${url} keeps rerunning in ${scope.id}; left as is until the next change`)
        burst = 0
        return
      }
      cooling ??= setTimeout(() => {
        burst = 0
        cooling = undefined
      })
      execute()
      scope.changed()
    })
  }

  const callTeardown = () => {
    const teardown = record.teardown
    record.teardown = undefined
    try {
      teardown?.()
    } catch (e) {
      console.error(`[environment] teardown of ${url} failed in ${scope.id}`, e)
    }
  }

  const stop = () => {
    if (detached) return
    detached = true
    for (const s of following) s()
    following = []
    clearTimeout(cooling)
    callTeardown()
    scope.dropAll(url)
  }

  execute()
  return { record, stop }
}

/** Hears the reads a behavior makes; wraps its callbacks. */
type Tracker = {
  read(key: string): void
  callback<T>(fn: () => T): T
}

/** The scope as a behavior sees it: the same interface, its puts attributed to `url`, its `.value` reads reported. */
function createFacade(scope: Scope, url: string, hooks: Tracker & { guard: (fn: () => void) => void }): Env {
  return {
    get id() {
      return scope.id
    },
    get parent() {
      return scope.parent
    },
    get forks() {
      return scope.forks
    },
    get behaviors() {
      return scope.behaviors
    },
    get: <T>(key: string) => scope.live<T>(key, hooks),
    entries: () => scope.entries(),
    conflicts: (key) => scope.conflicts(key),
    put: <T>(key: string, value: T | Handle<T>) => {
      let handle!: Handle<T>
      hooks.guard(() => {
        handle = scope.set(key, value, url)
      })
      return handle
    },
    choose: (key, by) => scope.choose(key, by),
    attach: (run, by) => scope.attach(run, by),
    detach: (by) => scope.detach(by),
    fork: (name) => scope.fork(name),
    destroy: () => scope.destroy(),
    subscribe: (fn) => scope.subscribe(fn),
    lookup: (id) => scope.lookup(id),
  }
}

/** The visible candidate of a binding: the chosen one if present, else the last put. */
function winner(binding: Binding): Handle {
  if (binding.chosen !== undefined && binding.candidates.has(binding.chosen))
    return binding.candidates.get(binding.chosen)!
  const all = [...binding.candidates.values()]
  return all[all.length - 1]
}

/** Subscribes `fn` to `handle`'s changes, skipping the call subscribe makes right away. */
function listen(handle: Handle | undefined, fn: () => void): () => void {
  if (!handle) return () => {}
  let priming = true
  const stop = handle.subscribe(() => {
    if (!priming) fn()
  })
  priming = false
  return stop
}

/** Whether a binding at `prefix` covers `key`: the same key, or a path below it. */
function covers(prefix: string, key: string): boolean {
  return key === prefix || key.startsWith(`${prefix}/`)
}
