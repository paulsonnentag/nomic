import { createHandle, field, isHandle, walk } from "./handle.js"

/** A fresh root environment: no parent, nothing bound. */
export function createEnvironment() {
  return new Env(undefined)
}

/**
 * A scope of named values. Keys are paths: a binding at `imports` covers
 * `imports/core`, whose lookup reaches into the bound value. Forks see their
 * parent's bindings and can shadow them. Behaviors attach to an environment and
 * put bindings into it; every put made by a behavior is attributed to it and
 * dropped when it detaches. When several behaviors put the same key here, all
 * their values are kept as candidates and one is visible: the chosen one, else
 * the last put. There are no defaults: `get` never creates a binding, its
 * handle is empty until someone puts one.
 */
class Env {
  constructor(parent) {
    this.kind = "env"
    this.parent = parent
    this.slots = new Map() // key -> { candidates: Map<by, { handle, stop }>, chosen: by | undefined }
    this.listeners = new Map() // key -> Set<fn>
    this.ownListeners = new Map() // key -> Set<fn>, for `own`: bindings made here only
    this.watchers = new Set()
    this.forks = new Set()
    this.attached = [] // [{ behavior, meta, by, view, detach, info }]
    this.destroyed = false
  }

  get behaviors() {
    return this.attached.map((a) => a.behavior)
  }

  // -- inspecting --

  /**
   * What is here, for tooling: the bindings made in this environment — the
   * visible value and the attachment that put it (`by`: the behavior's file at
   * its pin, or its function name), every candidate put at the key, and the
   * chosen one, if any — the behaviors attached (each a behavior document,
   * see `attachThrough`, with the layer it sees the environment through), and
   * the forks and layers below.
   */
  inspect() {
    return {
      kind: this.kind,
      bindings: [...this.slots].map(([key, slot]) => {
        const [by, winner] = this.winner(slot)
        return {
          key,
          handle: winner.handle,
          by,
          chosen: slot.chosen,
          alternatives: [...slot.candidates].map(([by, c]) => ({ by, handle: c.handle })),
        }
      }),
      behaviors: this.attached.map(({ info, view }) => ({
        ...info.value,
        handle: info,
        layer: view === this ? undefined : view,
      })),
      forks: [...this.forks],
    }
  }

  /** Calls `fn` when the structure here or below changes: a binding put or dropped, a behavior attached or detached, a fork made or destroyed. */
  watch(fn) {
    this.watchers.add(fn)
    return () => this.watchers.delete(fn)
  }

  // -- reading --

  /** A live handle on whatever is or will be visible at `key`. */
  get(key) {
    return this.live(key)
  }

  /**
   * A live handle on what is bound at `key` in this environment itself, not
   * inherited from above: a view's own `dom`, say, which a fork must not take
   * from its parent while it has none.
   */
  own(key) {
    return this.live(key, true)
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

  /** Makes the candidate put at `key` by `by` the visible one; `undefined` goes back to the last put. */
  choose(key, by) {
    const slot = this.slots.get(key)
    if (!slot) throw new Error(`nothing is bound at "${key}" here`)
    if (by !== undefined && !slot.candidates.has(by)) throw new Error(`"${by}" put nothing at "${key}" here`)
    slot.chosen = by
    this.notify(key)
    this.changed()
  }

  // -- behaviors --

  /** Attaches `behavior`; `meta` ({ package, name }) says where it came from, for `inspect`. */
  attach(behavior, meta) {
    return this.attachThrough(this, behavior, meta)
  }

  // -- lifetime --

  fork() {
    const child = new Env(this)
    this.forks.add(child)
    this.changed()
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
    for (const slot of this.slots.values()) for (const c of slot.candidates.values()) c.stop()
    this.slots.clear()
    this.listeners.clear()
    this.ownListeners.clear()
    this.watchers.clear()
    this.parent?.forks.delete(this)
    this.parent?.changed()
  }

  // -- internals, shared with layers and the attributed view of a behavior --

  /**
   * Attaches `behavior` here; it sees the environment through `view` (this, or
   * a layer in front of it). The attachment is known by the behavior's file at
   * its pin when it was mounted from a package, else by the function's name;
   * the same behavior attaches to an environment once. The attachment is
   * described by a behavior document, a handle on
   * `{ "@patchwork": { type: "behavior" }, by, name, package, pin, module }`
   * (what `mount` recorded: the package's headless url, the pin the module was
   * read at, the manifest name and the module path), so tooling can show it
   * like any document.
   */
  attachThrough(view, behavior, meta) {
    if (this.destroyed) return () => {} // behaviors may arrive after the view that wanted them is gone
    const by = meta ? `${meta.pin}/${meta.module}` : behavior.name || "behavior"
    if (this.attached.some((a) => a.by === by)) throw new Error(`"${by}" is already attached here`)
    const info = createHandle({
      "@patchwork": { type: "behavior" },
      by,
      name: meta?.name ?? behavior.name,
      package: meta?.package,
      pin: meta?.pin,
      module: meta?.module,
    })
    let teardown
    let detached = false
    const detach = () => {
      if (detached) return
      detached = true
      teardown?.()
      for (const env of new Set([this, view])) {
        for (const [key, slot] of [...env.slots]) if (slot.candidates.has(by)) env.drop(key, by)
      }
      this.attached = this.attached.filter((a) => a !== entry)
      this.changed()
    }
    const entry = { behavior, meta, by, view, detach, info }
    this.attached.push(entry)
    teardown = behavior(attributed(view, by, detach))
    this.changed()
    return detach
  }

  /**
   * Puts `handle` at `key` on this environment as the candidate of `by`,
   * replacing what `by` put there before. It is the visible value unless
   * another candidate is chosen.
   */
  set(key, handle, by) {
    for (const bound of [...this.slots.keys()]) {
      if (bound !== key && covers(key, bound)) this.drop(bound) // unreachable from now on: covered by `key`
    }
    let slot = this.slots.get(key)
    if (!slot) this.slots.set(key, (slot = { candidates: new Map(), chosen: undefined }))
    slot.candidates.get(by)?.stop()
    slot.candidates.delete(by) // re-inserted last: the latest put wins by default
    const candidate = { handle, stop: () => {} }
    slot.candidates.set(by, candidate)
    // Subscribing forwards every change of the value into the environment while
    // it is the visible one, and the first call is the notification for this set.
    candidate.stop = handle.subscribe(() => {
      if (this.winner(slot)[1] === candidate) this.notify(key)
    })
    this.changed()
    return this.live(key)
  }

  /** The visible candidate of a slot: [by, { handle, stop }] — the chosen one, else the last put. */
  winner(slot) {
    if (slot.chosen !== undefined && slot.candidates.has(slot.chosen))
      return [slot.chosen, slot.candidates.get(slot.chosen)]
    const all = [...slot.candidates]
    return all[all.length - 1]
  }

  /** A live handle: it always reports what is visible at `key` from here (`own`: bound here only). */
  live(key, own = false) {
    const env = this
    return {
      get value() {
        return env.lookup(key, own)
      },
      change(fn) {
        const found = env.resolve(key, own)
        if (!found) throw new Error(`nothing is visible at "${key}"`)
        if (found.rest.length === 0) found.handle.change(fn)
        else field(found.handle, ...found.rest).change(fn)
      },
      subscribe(fn) {
        const listeners = own ? env.ownListeners : env.listeners
        let fns = listeners.get(key)
        if (!fns) listeners.set(key, (fns = new Set()))
        fns.add(fn)
        const value = env.lookup(key, own)
        if (value !== undefined) fn(value)
        return () => fns.delete(fn)
      },
    }
  }

  /** The value visible at `key` from here; undefined if nothing is. */
  lookup(key, own = false) {
    const found = this.resolve(key, own)
    if (!found) return undefined
    return found.rest.length ? walk(found.handle.value, found.rest) : found.handle.value
  }

  /**
   * The visible handle at `key`: in the nearest environment binding `key` or a
   * prefix of it (`own`: this one only), the longest such key's winner.
   */
  resolve(key, own = false) {
    for (let env = this; env; env = own ? undefined : env.parent) {
      const bound = env.match(key)
      if (bound !== undefined) {
        const [, winner] = env.winner(env.slots.get(bound))
        return { env, handle: winner.handle, rest: key.slice(bound.length).split("/").filter(Boolean) }
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

  /** Removes what `by` put at `key`, or with no `by` every candidate; the next candidate becomes visible. */
  drop(key, ...rest) {
    const slot = this.slots.get(key)
    if (!slot) return
    if (rest.length === 0) {
      for (const c of slot.candidates.values()) c.stop()
      slot.candidates.clear()
    } else {
      const [by] = rest
      slot.candidates.get(by)?.stop()
      slot.candidates.delete(by)
      if (slot.chosen === by) slot.chosen = undefined
    }
    if (slot.candidates.size === 0) this.slots.delete(key)
    this.notify(key)
    this.changed()
  }

  notify(key) {
    this.fire(key, this)
  }

  /** Tells the watchers here and above that the structure changed. */
  changed() {
    for (const fn of [...this.watchers]) fn()
    this.parent?.changed()
  }

  /**
   * Tells the listeners at `key` and below it, here and in every fork that does
   * not shadow them on the way to `origin`; `own` listeners only at the origin.
   */
  fire(key, origin) {
    for (const [listened, fns] of this.listeners) {
      if (!covers(key, listened)) continue
      if (this !== origin && this.shadows(listened, origin)) continue
      const value = this.lookup(listened)
      if (value !== undefined) for (const fn of [...fns]) fn(value)
    }
    if (this === origin) {
      for (const [listened, fns] of this.ownListeners) {
        if (!covers(key, listened)) continue
        const value = this.lookup(listened, true)
        if (value !== undefined) for (const fn of [...fns]) fn(value)
      }
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
    this.kind = "layer"
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

  own(key) {
    return this.covered(key) ? super.own(key) : this.base.own(key)
  }

  attach(behavior, meta) {
    return this.base.attachThrough(this, behavior, meta)
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
    own: (key) => env.own(key),
    put: (key, value) => env.set(key, isHandle(value) ? value : createHandle(value), by),
    entries: () => env.entries(),
    attach: (behavior, meta) => env.attach(behavior, meta),
    fork: () => env.fork(),
    layer: (bindings) => env.layer(bindings),
    inspect: () => env.inspect(),
    watch: (fn) => env.watch(fn),
    choose: (key, by) => env.choose(key, by),
    destroy: detach,
  }
}

/** Whether a binding at `prefix` covers `key`: the same key, or a path below it. */
function covers(prefix, key) {
  return key === prefix || key.startsWith(`${prefix}/`)
}
