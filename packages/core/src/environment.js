import { createHandle, field, isHandle, walk } from "./handle.js"

/** A fresh root environment: no parent, nothing bound. */
export function createEnvironment() {
  return new Env(undefined)
}

let count = 0

/**
 * A scope of named values. Keys are paths: a binding at `imports` covers
 * `imports/core`, whose lookup reaches into the bound value. Forks see their
 * parent's bindings and can shadow them. Behaviors attach to an environment and
 * put bindings into it; every put made by a behavior is attributed to it and
 * dropped when it detaches. There are no defaults: `get` never creates a
 * binding, its handle is empty until someone puts one.
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

  /** A live handle on whatever is or will be visible at `key`. */
  get(key) {
    return this.live(key)
  }

  /** The bindings visible from here, nearest first, as live handles. */
  entries() {
    const out = {}
    for (let env = this; env; env = env.parent) {
      for (const key of env.slots.keys()) {
        if (!Object.keys(out).some((bound) => covers(bound, key))) out[key] = this.live(key)
      }
    }
    return out
  }

  // -- writing --

  /** Binds `key` here, shadowing what is above and covering what is below it. */
  put(key, value) {
    return this.set(key, isHandle(value) ? value : createHandle(value), undefined)
  }

  // -- behaviors --

  attach(behavior) {
    return this.attachThrough(this, behavior)
  }

  // -- lifetime --

  fork() {
    const child = new Env(this)
    this.forks.add(child)
    return child
  }

  /** This environment with `bindings` in front of it: reads and writes of those keys stay in the layer, everything else passes through. */
  layer(bindings) {
    return new Layer(this, bindings)
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

  // -- internals, shared with layers and the attributed view of a behavior --

  /** Attaches `behavior` here; it sees the environment through `view` (this, or a layer in front of it). */
  attachThrough(view, behavior) {
    if (this.destroyed) return () => {} // behaviors may arrive after the view that wanted them is gone
    const by = `${behavior.name || "behavior"}#${count++}`
    let teardown
    let detached = false
    const detach = () => {
      if (detached) return
      detached = true
      teardown?.()
      for (const env of new Set([this, view])) {
        for (const [key, slot] of [...env.slots]) if (slot.by === by) env.drop(key)
      }
      this.attached = this.attached.filter((a) => a !== entry)
    }
    const entry = { behavior, detach }
    this.attached.push(entry)
    teardown = behavior(attributed(view, by, detach))
    return detach
  }

  /** Sets the slot at `key` on this environment, attributed to `by`. */
  set(key, handle, by) {
    for (const bound of [...this.slots.keys()]) {
      if (bound !== key && covers(key, bound)) {
        this.slots.get(bound).stop() // unreachable from now on: covered by `key`
        this.slots.delete(bound)
      }
    }
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
        return env.lookup(key)
      },
      change(fn) {
        const found = env.resolve(key)
        if (!found) throw new Error(`nothing is visible at "${key}"`)
        if (found.rest.length === 0) found.slot.handle.change(fn)
        else field(found.slot.handle, ...found.rest).change(fn)
      },
      subscribe(fn) {
        let fns = env.listeners.get(key)
        if (!fns) env.listeners.set(key, (fns = new Set()))
        fns.add(fn)
        const value = env.lookup(key)
        if (value !== undefined) fn(value)
        return () => fns.delete(fn)
      },
    }
  }

  /** The value visible at `key` from here; undefined if nothing is. */
  lookup(key) {
    const found = this.resolve(key)
    if (!found) return undefined
    return found.rest.length ? walk(found.slot.handle.value, found.rest) : found.slot.handle.value
  }

  /** The binding visible at `key`: in the nearest environment binding `key` or a prefix of it, the longest such key. */
  resolve(key) {
    for (let env = this; env; env = env.parent) {
      const bound = env.match(key)
      if (bound !== undefined) {
        return { env, slot: env.slots.get(bound), rest: key.slice(bound.length).split("/").filter(Boolean) }
      }
    }
    return undefined
  }

  /** The longest key bound here that is `key` or a prefix of it. */
  match(key) {
    let best
    for (const bound of this.slots.keys()) {
      if (covers(bound, key) && (best === undefined || bound.length > best.length)) best = bound
    }
    return best
  }

  drop(key) {
    const slot = this.slots.get(key)
    if (!slot) return
    slot.stop()
    this.slots.delete(key)
    this.notify(key)
  }

  notify(key) {
    this.fire(key, this)
  }

  /** Tells the listeners at `key` and below it, here and in every fork that does not shadow them on the way to `origin`. */
  fire(key, origin) {
    for (const [listened, fns] of this.listeners) {
      if (!covers(key, listened)) continue
      if (this !== origin && this.shadows(listened, origin)) continue
      const value = this.lookup(listened)
      if (value !== undefined) for (const fn of [...fns]) fn(value)
    }
    for (const fork of this.forks) fork.fire(key, origin)
  }

  /** Whether an environment between here (inclusive) and `origin` (exclusive) binds `key` or a prefix of it. */
  shadows(key, origin) {
    for (let env = this; env && env !== origin; env = env.parent) if (env.match(key) !== undefined) return true
    return false
  }
}

/**
 * Bindings in front of an environment. A layer is not a scope: it holds only the
 * keys it was made with (and what is put under them); every other read, write,
 * attach and fork goes to the environment behind it.
 */
class Layer extends Env {
  constructor(base, bindings) {
    super(base)
    this.base = base
    this.keys = Object.keys(bindings)
    base.forks.add(this) // so changes behind the layer reach listeners in front of it
    for (const [key, value] of Object.entries(bindings)) {
      super.set(key, isHandle(value) ? value : createHandle(value), undefined)
    }
  }

  get behaviors() {
    return this.base.behaviors
  }

  covered(key) {
    return this.keys.some((bound) => covers(bound, key))
  }

  set(key, handle, by) {
    return this.covered(key) ? super.set(key, handle, by) : this.base.set(key, handle, by)
  }

  attach(behavior) {
    return this.base.attachThrough(this, behavior)
  }

  fork() {
    return this.base.fork()
  }

  layer(bindings) {
    return this.base.layer(bindings)
  }

  destroy() {
    if (this.base.destroyed) super.destroy()
    else this.base.destroy()
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
    get: (key) => env.live(key),
    put: (key, value) => env.set(key, isHandle(value) ? value : createHandle(value), by),
    entries: () => env.entries(),
    attach: (behavior) => env.attach(behavior),
    fork: () => env.fork(),
    layer: (bindings) => env.layer(bindings),
    destroy: detach,
  }
}

/** Whether a binding at `prefix` covers `key`: the same key, or a path below it. */
function covers(prefix, key) {
  return key === prefix || key.startsWith(`${prefix}/`)
}
