// The Nomic runtime: environments, handles, behaviors, records.
// See spec.md for the semantics this file implements.

export type Key = string
export type Id = string
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

export type Handle<T> = {
  readonly value: T
  change(fn: (value: T) => T | void): void
  subscribe(fn: (value: T) => void): () => void
}

export type Teardown = () => void

export type Behavior = {
  title: string
  description: string
  mount(environment: Environment): Teardown | void | Promise<Teardown | void>
}

export type Attachment = { url: string; on: boolean }
export type Record = { [key: Key]: Json }

export type Environment = {
  readonly parent: Environment | undefined
  get<T>(key: Key, defaultValue?: T): Handle<T>
  put(key: Key, value: unknown): void
  hide(key: Key): void
  entries(): { [key: Key]: Handle<unknown> }
  attach(behavior: Behavior): () => void
  load(record: Handle<Record>): void
  fork(): Environment
  close(): void
}

export class NotFound extends Error {
  constructor(readonly key: string) {
    super(`nothing is visible at "${key}"`)
  }
}

// ---- handles -------------------------------------------------------------------

/** A handle over a plain value. */
export function wrap<T>(initial: T): Handle<T> {
  let value = initial
  const subs = new Set<(value: T) => void>()
  return {
    get value() {
      return value
    },
    change(fn) {
      const next = fn(value)
      if (next !== undefined) value = next
      for (const fn of [...subs]) fn(value)
    },
    subscribe(fn) {
      subs.add(fn)
      fn(value)
      return () => subs.delete(fn)
    },
  }
}

/** A handle into a value. A change writes through to where the value lives. */
export function field<T>(handle: Handle<unknown>, ...keys: string[]): Handle<T> {
  const path = keys.join(".")
  const walk = (root: unknown): T => {
    let cur: any = root
    for (const key of keys) {
      if (cur === null || typeof cur !== "object" || !(key in cur)) throw new NotFound(path)
      cur = cur[key]
    }
    return cur
  }
  return {
    get value() {
      return walk(handle.value)
    },
    change(fn) {
      handle.change((root: any) => {
        let parent: any = undefined
        let cur: any = root
        for (const key of keys) {
          if (cur === null || typeof cur !== "object" || !(key in cur)) throw new NotFound(path)
          parent = cur
          cur = cur[key]
        }
        const next = fn(cur)
        if (next !== undefined) {
          if (parent === undefined) return next as any
          parent[keys[keys.length - 1]] = next
        }
      })
    },
    subscribe(fn) {
      let first = true
      let last: T
      return handle.subscribe((root) => {
        let value: T
        try {
          value = walk(root)
        } catch (e) {
          if (e instanceof NotFound) return
          throw e
        }
        // Primitives that didn't change are not a change. Objects may have been
        // edited in place, so they always count.
        if (!first && (value === null || typeof value !== "object") && value === last) return
        first = false
        last = value
        fn(value)
      })
    },
  }
}

// ---- environments ----------------------------------------------------------------

type Slot = {
  handle: Handle<unknown> | null // null is a hide
  owner: string | null // the behavior that holds the slot; null for the shell
  declared: boolean
  stop: () => void // stops forwarding the handle's changes into the environment
}

type Options = {
  import?(url: string): Promise<{ default: Behavior }>
}

let nextId = 0

class Env implements Environment {
  readonly parent: Env | undefined
  protected slots = new Map<Key, Slot>()
  protected listeners = new Map<Key, Set<(value: unknown) => void>>()
  protected forks = new Set<Env>()
  protected options: Options
  protected closed = false

  // What `load` set up: the followed record, the attached behaviors, the declared keys.
  private record: Handle<Record> | undefined
  private unfollow: (() => void) | undefined
  private attached = new Map<Id, { url: string; detach: () => void }>()
  private queue = Promise.resolve()

  constructor(parent: Env | undefined, options: Options) {
    this.parent = parent
    this.options = options
  }

  // -- resolution --

  /** The environment that owns the slot at `key`, walking up the fork chain. */
  protected resolve(key: Key): Slot | undefined {
    let env: Env | undefined = this
    while (env) {
      const slot = env.slots.get(key)
      if (slot) return slot
      env = env.parent
    }
    return undefined
  }

  protected read(key: Key): Handle<unknown> {
    const slot = this.resolve(key)
    if (!slot || !slot.handle) throw new NotFound(key)
    return slot.handle
  }

  /** Tell the listeners at `key`, here and in every fork that doesn't shadow it. */
  protected notify(key: Key) {
    const fns = this.listeners.get(key)
    if (fns) {
      let value: unknown
      let visible = true
      try {
        value = this.read(key).value
      } catch (e) {
        if (!(e instanceof NotFound)) throw e
        visible = false
      }
      if (visible) for (const fn of [...fns]) fn(value)
    }
    for (const fork of this.forks) if (!fork.slots.has(key)) fork.notify(key)
  }

  // -- reading --

  get<T>(key: Key, defaultValue?: T): Handle<T> {
    if (arguments.length > 1) {
      try {
        this.read(key)
      } catch (e) {
        if (!(e instanceof NotFound)) throw e
        this.put(key, defaultValue)
      }
    } else {
      this.read(key) // throws NotFound
    }
    return this.handleFor<T>(key)
  }

  /** A live handle: it always reports what is visible at `key` from here. */
  protected handleFor<T>(key: Key): Handle<T> {
    const env = this
    return {
      get value() {
        return env.read(key).value as T
      },
      change(fn) {
        env.read(key).change(fn as (value: unknown) => unknown)
      },
      subscribe(fn) {
        let fns = env.listeners.get(key)
        if (!fns) env.listeners.set(key, (fns = new Set()))
        const listener = fn as (value: unknown) => void
        fns.add(listener)
        try {
          fn(env.read(key).value as T)
        } catch (e) {
          if (!(e instanceof NotFound)) throw e
        }
        return () => fns!.delete(listener)
      },
    }
  }

  entries(): { [key: Key]: Handle<unknown> } {
    const out: { [key: Key]: Handle<unknown> } = {}
    const seen = new Set<Key>()
    let env: Env | undefined = this
    while (env) {
      for (const [key, slot] of env.slots) {
        if (seen.has(key)) continue
        seen.add(key)
        if (slot.handle) out[key] = this.handleFor(key)
      }
      env = env.parent
    }
    return out
  }

  // -- writing --

  put(key: Key, value: unknown) {
    this.setSlot(key, wrap(value), null, false)
  }

  hide(key: Key) {
    this.setSlot(key, null, null, false)
  }

  setSlot(key: Key, handle: Handle<unknown> | null, owner: string | null, declared: boolean) {
    const old = this.slots.get(key)
    if (old?.declared && !declared) throw new Error(`"${key}" is declared by the record; change it instead of putting`)
    old?.stop()
    if (!handle) {
      this.slots.set(key, { handle, owner, declared, stop: () => {} })
      this.notify(key)
      return
    }
    // Subscribing forwards every change of the value into the environment,
    // and the first call is the notification for this put.
    const slot: Slot = { handle, owner, declared, stop: () => {} }
    this.slots.set(key, slot)
    slot.stop = handle.subscribe(() => this.notify(key))
  }

  protected dropSlot(key: Key) {
    const slot = this.slots.get(key)
    if (!slot) return
    slot.stop()
    this.slots.delete(key)
    this.notify(key)
  }

  /** Clears every slot that `owner` holds. */
  protected dropOwned(owner: string) {
    for (const [key, slot] of [...this.slots]) if (slot.owner === owner) this.dropSlot(key)
  }

  // -- behaviors --

  attach(behavior: Behavior): () => void {
    const owner = `${behavior.title}#${nextId++}`
    const hand = new Hand(this, owner, this.options)
    this.forks.add(hand)
    let teardown: Teardown | void | undefined
    let detached = false
    const result = behavior.mount(hand)
    if (result instanceof Promise) {
      result.then((t) => {
        if (detached) t?.()
        else teardown = t
      })
    } else {
      teardown = result
    }
    return () => {
      if (detached) return
      detached = true
      this.dropOwned(owner)
      teardown?.()
      hand.close()
      this.forks.delete(hand)
    }
  }

  fork(): Environment {
    const child = new Env(this, this.options)
    this.forks.add(child)
    return child
  }

  // -- records --

  load(record: Handle<Record>) {
    if (this.record) throw new Error("already loaded")
    this.record = record
    this.unfollow = record.subscribe((r) => this.follow(r))
  }

  /** Bring declared values and behaviors in line with the record. */
  private follow(r: Record) {
    // Declared values: a field added is declared; a field removed is dropped.
    for (const key of Object.keys(r)) {
      if (!this.slots.get(key)?.declared) this.setSlot(key, field(this.record!, key), null, true)
    }
    for (const [key, slot] of [...this.slots]) {
      if (slot.declared && !(key in r)) this.dropSlot(key)
    }
    // Behaviors are attached in record order, one at a time, so that a behavior
    // sees the puts of the behaviors before it.
    this.queue = this.queue.then(() => this.syncBehaviors()).catch((e) => console.error(e))
  }

  private async syncBehaviors() {
    if (this.closed) return
    const behaviors = (this.record!.value.behaviors ?? {}) as { [id: Id]: Attachment }
    for (const [id, a] of Object.entries(behaviors)) {
      const current = this.attached.get(id)
      if (current && (!a.on || current.url !== a.url)) {
        current.detach()
        this.attached.delete(id)
      }
      if (a.on && !this.attached.has(id)) {
        const load = this.options.import ?? ((url: string) => import(/* @vite-ignore */ url))
        const mod = await load(a.url)
        if (this.closed) return
        // The record may have changed while the import was in flight.
        const now = ((this.record!.value.behaviors ?? {}) as { [id: Id]: Attachment })[id]
        if (!now?.on || now.url !== a.url) continue
        this.attached.set(id, { url: a.url, detach: this.attach(mod.default) })
      }
    }
    for (const [id, current] of [...this.attached]) {
      if (!(id in behaviors)) {
        current.detach()
        this.attached.delete(id)
      }
    }
  }

  // -- lifetime --

  close() {
    if (this.closed) return
    this.closed = true
    for (const fork of [...this.forks]) fork.close()
    for (const { detach } of [...this.attached.values()].reverse()) detach()
    this.attached.clear()
    this.unfollow?.()
    for (const slot of this.slots.values()) slot.stop()
    this.slots.clear()
    this.listeners.clear()
    this.parent?.forks.delete(this)
  }

  /** For the inspector: which behavior holds the slot at `key` here. */
  ownerOf(key: Key): string | null | undefined {
    return this.slots.get(key)?.owner
  }
}

/** The fork the runtime makes for one behavior. Its puts land on the environment. */
class Hand extends Env {
  constructor(private target: Env, private owner: string, options: Options) {
    super(target, options)
  }
  put(key: Key, value: unknown) {
    this.target.setSlot(key, wrap(value), this.owner, false)
  }
  hide(key: Key) {
    this.target.setSlot(key, null, this.owner, false)
  }
  load(): void {
    throw new Error("a behavior loads a fork, not its own environment")
  }
}

export function createEnvironment(options: Options = {}): Environment {
  return new Env(undefined, options)
}
