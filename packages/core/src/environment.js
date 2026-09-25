import { createHandle, isHandle } from "./handle.js"

/** A fresh root environment: no parent, nothing visible. */
export function createEnvironment() {
  return new Env(undefined)
}

let count = 0

/**
 * A scope of named values. Forks see their parent's values and can shadow
 * them. Behaviors attach to an environment and put values into it; every
 * put made by a behavior is attributed to it and dropped when it detaches.
 */
class Env {
  constructor(parent) {
    this.parent = parent
    this.slots = new Map() // key -> { handle, by, stop }
    this.listeners = new Map() // key -> Set<fn>
    this.forks = new Set()
    this.attached = [] // [{ behavior, detach }]
    this.destroyed = false
  }

  get behaviors() {
    return this.attached.map((a) => a.behavior)
  }

  // -- reading --

  get(key, defaultValue) {
    if (!this.has(key)) {
      if (arguments.length < 2) throw new Error(`nothing is visible at "${key}"`)
      this.put(key, defaultValue)
    }
    return this.live(key)
  }

  entries() {
    const out = {}
    for (let env = this; env; env = env.parent) {
      for (const key of env.slots.keys()) if (!(key in out)) out[key] = this.live(key)
    }
    return out
  }

  // -- writing --

  put(key, value) {
    return this.set(key, isHandle(value) ? value : createHandle(value), undefined)
  }

  // -- behaviors --

  attach(behavior) {
    if (this.destroyed) return () => {} // behaviors may arrive after the view that wanted them is gone
    const by = `${behavior.name || "behavior"}#${count++}`
    let teardown
    let detached = false
    const detach = () => {
      if (detached) return
      detached = true
      teardown?.()
      for (const [key, slot] of [...this.slots]) if (slot.by === by) this.drop(key)
      this.attached = this.attached.filter((a) => a !== entry)
    }
    const entry = { behavior, detach }
    this.attached.push(entry)
    teardown = behavior(attributed(this, by, detach))
    return detach
  }

  // -- lifetime --

  fork() {
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

  has(key) {
    return this.resolve(key) !== undefined
  }

  /** Sets the slot at `key` on this environment, attributed to `by`. */
  set(key, handle, by) {
    this.slots.get(key)?.stop()
    const slot = { handle, by, stop: () => {} }
    this.slots.set(key, slot)
    // Subscribing forwards every change of the value into the environment,
    // and the first call is the notification for this set.
    slot.stop = handle.subscribe(() => this.notify(key))
    return this.live(key)
  }

  /** A live handle: it always reports what is visible at `key` from here. */
  live(key) {
    const env = this
    return {
      get value() {
        return env.read(key).value
      },
      change(fn) {
        env.read(key).change(fn)
      },
      subscribe(fn) {
        let fns = env.listeners.get(key)
        if (!fns) env.listeners.set(key, (fns = new Set()))
        fns.add(fn)
        const slot = env.resolve(key)
        if (slot) fn(slot.handle.value)
        return () => fns.delete(fn)
      },
    }
  }

  drop(key) {
    const slot = this.slots.get(key)
    if (!slot) return
    slot.stop()
    this.slots.delete(key)
    this.notify(key)
  }

  /** The slot visible at `key` from here, walking up the fork chain. */
  resolve(key) {
    for (let env = this; env; env = env.parent) {
      const slot = env.slots.get(key)
      if (slot) return slot
    }
    return undefined
  }

  read(key) {
    const slot = this.resolve(key)
    if (!slot) throw new Error(`nothing is visible at "${key}"`)
    return slot.handle
  }

  /** Tells the listeners at `key`, here and in every fork that doesn't shadow it. */
  notify(key) {
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
function attributed(env, by, detach) {
  return {
    get parent() {
      return env.parent
    },
    get behaviors() {
      return env.behaviors
    },
    get(key, defaultValue) {
      if (env.has(key)) return env.live(key)
      if (arguments.length < 2) throw new Error(`nothing is visible at "${key}"`)
      return env.set(key, createHandle(defaultValue), by)
    },
    put(key, value) {
      return env.set(key, isHandle(value) ? value : createHandle(value), by)
    },
    entries: () => env.entries(),
    attach: (behavior) => env.attach(behavior),
    fork: () => env.fork(),
    destroy: detach,
  }
}
