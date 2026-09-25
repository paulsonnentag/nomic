import type { Behavior, Environment, Handle, Key, Teardown } from "./types"
import { createHandle, isHandle } from "./handle"

export function createEnvironment(): Environment {
  return new Env(undefined)
}

type Slot = {
  handle: Handle<unknown>
  by: string | undefined // the behavior that put it; undefined for the shell
  stop: () => void // stops forwarding the handle's changes into the environment
}

type Attached = { behavior: Behavior; detach: () => void }

let count = 0

class Env implements Environment {
  readonly parent: Env | undefined
  private slots = new Map<Key, Slot>()
  private listeners = new Map<Key, Set<(value: unknown) => void>>()
  private forks = new Set<Env>()
  private attached: Attached[] = []
  private destroyed = false

  constructor(parent: Env | undefined) {
    this.parent = parent
  }

  get behaviors(): readonly Behavior[] {
    return this.attached.map((a) => a.behavior)
  }

  // -- reading --

  get<T>(key: Key, defaultValue?: T): Handle<T> {
    if (!this.has(key)) {
      if (arguments.length < 2) throw new Error(`nothing is visible at "${key}"`)
      this.put(key, defaultValue as T)
    }
    return this.live<T>(key)
  }

  entries(): { [key: Key]: Handle<unknown> } {
    const out: { [key: Key]: Handle<unknown> } = {}
    for (let env: Env | undefined = this; env; env = env.parent) {
      for (const key of env.slots.keys()) if (!(key in out)) out[key] = this.live(key)
    }
    return out
  }

  // -- writing --

  put<T>(key: Key, value: T | Handle<T>): Handle<T> {
    return this.set(key, isHandle(value) ? value : createHandle(value), undefined)
  }

  // -- behaviors --

  attach(behavior: Behavior): () => void {
    if (this.destroyed) return () => {} // behaviors may arrive after the view that wanted them is gone
    const by = `${behavior.name || "behavior"}#${count++}`
    let teardown: Teardown | void
    let detached = false
    const detach = () => {
      if (detached) return
      detached = true
      teardown?.()
      for (const [key, slot] of [...this.slots]) if (slot.by === by) this.drop(key)
      this.attached = this.attached.filter((a) => a !== entry)
    }
    const entry: Attached = { behavior, detach }
    this.attached.push(entry)
    teardown = behavior(attributed(this, by, detach))
    return detach
  }

  // -- lifetime --

  fork(): Environment {
    const child = new Env(this)
    this.forks.add(child)
    return child
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    for (const fork of [...this.forks]) fork.destroy()
    for (const a of [...this.attached].reverse()) a.detach()
    for (const slot of this.slots.values()) slot.stop()
    this.slots.clear()
    this.listeners.clear()
    this.parent?.forks.delete(this)
  }

  // -- internals, shared with the attributed view of a behavior --

  has(key: Key): boolean {
    return this.resolve(key) !== undefined
  }

  /** Sets the slot at `key` on this environment, attributed to `by`. */
  set<T>(key: Key, handle: Handle<unknown>, by: string | undefined): Handle<T> {
    this.slots.get(key)?.stop()
    const slot: Slot = { handle, by, stop: () => {} }
    this.slots.set(key, slot)
    // Subscribing forwards every change of the value into the environment,
    // and the first call is the notification for this set.
    slot.stop = handle.subscribe(() => this.notify(key))
    return this.live<T>(key)
  }

  /** A live handle: it always reports what is visible at `key` from here. */
  live<T>(key: Key): Handle<T> {
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
        const slot = env.resolve(key)
        if (slot) fn(slot.handle.value as T)
        return () => fns!.delete(listener)
      },
    }
  }

  private drop(key: Key) {
    const slot = this.slots.get(key)
    if (!slot) return
    slot.stop()
    this.slots.delete(key)
    this.notify(key)
  }

  /** The slot visible at `key` from here, walking up the fork chain. */
  private resolve(key: Key): Slot | undefined {
    for (let env: Env | undefined = this; env; env = env.parent) {
      const slot = env.slots.get(key)
      if (slot) return slot
    }
    return undefined
  }

  private read(key: Key): Handle<unknown> {
    const slot = this.resolve(key)
    if (!slot) throw new Error(`nothing is visible at "${key}"`)
    return slot.handle
  }

  /** Tells the listeners at `key`, here and in every fork that doesn't shadow it. */
  private notify(key: Key) {
    const fns = this.listeners.get(key)
    if (fns) {
      const slot = this.resolve(key)
      if (slot) for (const fn of [...fns]) fn(slot.handle.value)
    }
    for (const fork of this.forks) if (!fork.slots.has(key)) fork.notify(key)
  }
}

/**
 * The environment as a behavior sees it: the same values and forks, but its
 * puts are attributed to the behavior, and destroying it detaches the behavior.
 */
function attributed(env: Env, by: string, detach: () => void): Environment {
  return {
    get parent() {
      return env.parent
    },
    get behaviors() {
      return env.behaviors
    },
    get<T>(key: Key, defaultValue?: T): Handle<T> {
      if (env.has(key)) return env.live<T>(key)
      if (arguments.length < 2) throw new Error(`nothing is visible at "${key}"`)
      return env.set<T>(key, createHandle(defaultValue), by)
    },
    put<T>(key: Key, value: T | Handle<T>): Handle<T> {
      return env.set<T>(key, isHandle(value) ? value : createHandle(value), by)
    },
    entries: () => env.entries(),
    attach: (behavior) => env.attach(behavior),
    fork: () => env.fork(),
    destroy: detach,
  }
}
