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
 * dropped when it detaches. Code that is not a behavior writes through `as`, so
 * its puts are attributed to its file too. A binding at `behaviors/<package url>` is a request
 * for that package's behaviors here and in every fork below, served by the
 * `reconciler`; it is how behaviors add behaviors. A behavior decides for itself whether it applies:
 * what it `read`s is tracked, and it is rerun when any of it changes, so one
 * that returned nothing (inactive) can wake up when, say, the data's type or a
 * binding it waits for appears. When several behaviors put the same key here, all
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
    this.trackers = new Set() // fns (key, origin, by) told of every change reaching here, for behaviors' reads
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

  /**
   * This environment as the file at `by` (its pinned url) writes to it: puts,
   * and the bindings of layers made through it, are attributed to the file, so
   * they show who made them like a behavior's do. For the code that is not a
   * behavior — bootstrap, the reconciler. Nothing is tracked or torn down.
   */
  as(by) {
    const none = () => {}
    return attributed(this, by, none, (key) => this.lookup(key), none, none)
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

  /**
   * Attaches `behavior`; `meta` ({ package, name, module }) says where it came
   * from, for `inspect`. For the framework and `mount`: behaviors do not get
   * this, they put a request at `behaviors/<url>`.
   */
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

  /** This environment with `bindings` in front of it, attributed to `by`: reads and writes of those keys stay in the layer, everything else passes through. */
  layer(bindings, by) {
    return new Layer(this, bindings, by)
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
    this.trackers.clear()
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
   * `{ "@patchwork": { type: "behavior" }, by, name, package, module, active, runs, reads, gets, puts, error }`
   * — what `mount` recorded (the package's pinned url, the manifest name and
   * the module path; `by` is the module's own pinned url, `package/module`)
   * and how the last run went: whether it returned a teardown, how often it
   * has run, what it read (`reads`: key and the value seen), what it got
   * without tracking and what it put (`gets`, `puts`: key and a live handle),
   * and what it threw — so tooling can show it like any document.
   */
  attachThrough(view, behavior, meta) {
    if (this.destroyed) return () => {} // behaviors may arrive after the view that wanted them is gone
    const by = meta ? `${meta.package}/${meta.module}` : behavior.name || "behavior"
    if (this.attached.some((a) => a.by === by)) throw new Error(`"${by}" is already attached here`)
    const info = createHandle({
      "@patchwork": { type: "behavior" },
      by,
      name: meta?.name ?? behavior.name,
      package: meta?.package,
      module: meta?.module,
      active: false,
      runs: 0,
      reads: [],
      gets: [],
      puts: [],
    })
    let teardown
    let detached = false
    let reads = new Map() // key -> the value `read` returned in the current run
    let gets = new Map() // key -> the live handle `get` or `own` returned since the run started
    let puts = new Map() // key -> the handle put since the run started
    let running = false
    let scheduled = false
    let burst = 0 // reruns since the last macrotask, to catch behaviors that feed each other
    let cooling
    const dropPuts = () => {
      for (const env of new Set([this, view])) {
        for (const [key, slot] of [...env.slots]) if (slot.candidates.has(by)) env.drop(key, by)
      }
    }
    /** A tracked read: the value visible at `key` from the view, remembered so a change to it reruns the behavior. */
    const read = (key) => {
      const value = view.lookup(key)
      reads.set(key, value)
      return value
    }
    /** An untracked get, remembered on the document; `handle` is the live handle it returned. */
    const got = (key, handle) => {
      gets.set(key, handle)
      if (!running) {
        info.change((d) => {
          d.gets = entries(gets)
        })
      }
    }
    /** A put, remembered on the document. Puts may come after the run, from callbacks; those update it right away. */
    const wrote = (key, handle) => {
      puts.set(key, handle)
      if (!running) {
        info.change((d) => {
          d.puts = entries(puts)
        })
      }
    }
    /**
     * Calls the behavior: the previous run is torn down and its puts dropped
     * first, so a run starts clean; what it read, got and put, whether it
     * returned a teardown (it is active then) and any error go on the document.
     */
    const run = () => {
      teardown?.()
      teardown = undefined
      dropPuts()
      reads = new Map()
      gets = new Map()
      puts = new Map()
      let error
      running = true
      try {
        teardown = behavior(attributed(view, by, detach, read, got, wrote))
      } catch (e) {
        error = e
        console.error(`[environment] ${by} failed`, e)
      }
      running = false
      info.change((d) => {
        d.runs += 1
        d.active = teardown !== undefined
        d.reads = [...reads].map(([key, value]) => ({ key, value }))
        d.gets = entries(gets)
        d.puts = entries(puts)
        if (error === undefined) delete d.error
        else d.error = String(error?.message ?? error)
      })
    }
    /** Told of every change reaching the view; reruns once the change settles when something read now differs, unless the behavior itself made it. */
    const tracker = (key, origin, changedBy) => {
      if (detached || scheduled || changedBy === by) return
      for (const [readKey, value] of reads) {
        if (!covers(key, readKey)) continue
        if (view !== origin && view.shadows(readKey, origin)) continue
        if (view.lookup(readKey) === value) continue
        scheduled = true
        queueMicrotask(() => {
          scheduled = false
          if (detached) return
          if (++burst > RERUNS) {
            console.error(`[environment] ${by} keeps rerunning; left as is until the next change`)
            burst = 0
            return
          }
          cooling ??= setTimeout(() => {
            burst = 0
            cooling = undefined
          })
          run()
          this.changed()
        })
        return
      }
    }
    const detach = () => {
      if (detached) return
      detached = true
      view.trackers.delete(tracker)
      clearTimeout(cooling)
      teardown?.()
      dropPuts()
      this.attached = this.attached.filter((a) => a !== entry)
      this.changed()
    }
    const entry = { behavior, meta, by, view, detach, info }
    this.attached.push(entry)
    view.trackers.add(tracker)
    run()
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
      if (this.winner(slot)[1] === candidate) this.notify(key, by)
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
    this.notify(key, rest[0])
    this.changed()
  }

  /** Tells listeners and trackers that what is at `key` changed; `by` is the attachment whose put or drop it was, if one. */
  notify(key, by) {
    this.fire(key, this, by)
  }

  /** Tells the watchers here and above that the structure changed. */
  changed() {
    for (const fn of [...this.watchers]) fn()
    this.parent?.changed()
  }

  /**
   * Tells the listeners at `key` and below it, here and in every fork that does
   * not shadow them on the way to `origin`; `own` listeners only at the origin.
   * Trackers hear of every change, including one that leaves nothing at the key.
   */
  fire(key, origin, by) {
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
    for (const tracker of [...this.trackers]) tracker(key, origin, by)
    for (const fork of this.forks) fork.fire(key, origin, by)
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
  constructor(base, bindings, by) {
    super(base)
    this.kind = "layer"
    this.base = base
    this.keys = Object.keys(bindings)
    base.forks.add(this) // so changes behind the layer reach listeners in front of it
    for (const [key, value] of Object.entries(bindings)) {
      super.set(key, isHandle(value) ? value : createHandle(value), by)
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

  layer(bindings, by) {
    return this.base.layer(bindings, by)
  }

  destroy() {
    if (this.base.destroyed) super.destroy()
    else this.base.destroy()
  }
}

/**
 * The environment as a behavior sees it: the same values and forks, but its
 * puts (and the layers it makes) are attributed to the behavior, `read` is
 * tracked, gets and puts are recorded on its document, and destroying it
 * detaches the behavior. There is no `attach`: a behavior asks for another by
 * putting a package url at `behaviors/<url>` (see `reconciler`), so the request
 * is attributed like any binding and dropped with it. Also what `as` gives
 * code that is not a behavior, with the tracking left out.
 */
function attributed(env, by, detach, read, got, wrote) {
  return {
    get parent() {
      return env.parent
    },
    get behaviors() {
      return env.behaviors
    },
    by, // what its puts are attributed to: the file's pinned url
    read,
    get: (key) => {
      const handle = env.live(key)
      got(key, handle)
      return handle
    },
    own: (key) => {
      const handle = env.own(key)
      got(key, handle)
      return handle
    },
    put: (key, value) => {
      const handle = isHandle(value) ? value : createHandle(value)
      wrote(key, handle)
      return env.set(key, handle, by)
    },
    entries: () => env.entries(),
    fork: () => env.fork(),
    layer: (bindings) => env.layer(bindings, by),
    inspect: () => env.inspect(),
    watch: (fn) => env.watch(fn),
    choose: (key, by) => env.choose(key, by),
    destroy: detach,
  }
}

const RERUNS = 100 // reruns of one behavior within a macrotask before it is left alone

/** A map of key → handle as the list a behavior document carries. */
function entries(map) {
  return [...map].map(([key, handle]) => ({ key, handle }))
}

/** Whether a binding at `prefix` covers `key`: the same key, or a path below it. */
function covers(prefix, key) {
  return key === prefix || key.startsWith(`${prefix}/`)
}
