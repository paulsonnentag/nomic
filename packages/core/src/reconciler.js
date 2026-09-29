import { mount } from "./mount.js"

/**
 * Attaches the packages the environments ask for. Not a behavior: bootstrap
 * calls it once with the root as this file (`env.as`), so the layers it makes
 * are attributed to it, and it runs for the life of the page. A request is a
 * binding at `behaviors/<package url>` whose value is the url: putting it
 * mounts the package there (its imports as a layer, its behaviors attached),
 * dropping it detaches them; asking for another url at the key remounts. Since
 * a request is an ordinary put, it is attributed to the behavior that made it,
 * and goes away with that behavior. Once mounted, the request's value is filled
 * in with what was found: `{ package, behaviors }` — the package's pinned url
 * and its manifest's behaviors, by name — or `{ package, error }` when mounting
 * failed, so the environment shows what each request came to. A request is
 * inherited: it is served in the environment it is put on and in every fork
 * below, each getting its own attachments — so the packages put on the root
 * reach every view, and each behavior decides where it applies. Serves the
 * whole tree under `root`, once per microtask. Packages mount independently:
 * behaviors rerun as what they read appears, so the order they arrive in does
 * not matter. Returns a function that stops and unmounts everything.
 */
export default function reconciler(root) {
  const states = new Map() // env -> { requests: Map<key, Request> }
  const by = root.by // this file, for the layers mounted through it
  let scheduled = false
  const stop = root.watch(schedule)
  schedule()
  return () => {
    stop()
    for (const state of states.values()) for (const r of state.requests.values()) unmount(r)
    states.clear()
  }

  function schedule() {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      reconcile()
    })
  }

  /** Brings every environment under `root` in line with its requests, and drops the state of those gone. */
  function reconcile() {
    const seen = new Set()
    visit(root)
    for (const [env, state] of states) {
      if (seen.has(env)) continue
      for (const r of state.requests.values()) unmount(r)
      states.delete(env)
    }

    function visit(env) {
      if (env.kind !== "layer") {
        seen.add(env)
        sync(env)
      }
      for (const fork of env.inspect().forks) visit(fork)
    }
  }

  /** Mounts what `env` newly asks for and unmounts what it no longer does. */
  function sync(env) {
    let state = states.get(env)
    if (!state) states.set(env, (state = { requests: new Map() }))
    const wanted = requestsAt(env)
    for (const [key, r] of state.requests) {
      const w = wanted.find((w) => w.key === key)
      // Still the handle it filled in, or a new one asking for the same url: keep the mount.
      if (w && (w.handle === r.handle || urlOf(w.handle.value) === r.url)) {
        if (w.handle !== r.handle) {
          r.handle = w.handle
          if (r.own) fill(r.handle, r.found)
        }
        continue
      }
      unmount(r)
      state.requests.delete(key)
    }
    for (const w of wanted) {
      const url = urlOf(w.handle.value)
      if (state.requests.has(w.key) || !url) continue
      const r = { url, handle: w.handle, own: w.own, detach: undefined, found: undefined, cancelled: false }
      state.requests.set(w.key, r)
      mount(env, url, by)
        .then(({ detach, package: pkg, behaviors }) => {
          // Dropped while loading: undo right away.
          if (r.cancelled) return detach()
          r.detach = detach
          r.found = { package: pkg, behaviors }
          if (r.own) fill(r.handle, r.found)
        })
        .catch((error) => {
          console.error(`[reconciler] mounting ${url} failed`, error)
          r.found = { package: url, error: String(error?.message ?? error) }
          if (r.own && !r.cancelled) fill(r.handle, r.found)
        })
    }
  }

  function unmount(r) {
    r.cancelled = true
    r.detach?.()
  }
}

/**
 * The requests visible from `env`: its own and those of the environments above
 * it, the nearest binding of a key winning — `{ key, handle, own }`, `own` when
 * `env` made the binding itself. Only the environment that owns a request
 * fills it in; the forks it reaches mount the same package silently.
 */
function requestsAt(env) {
  const out = new Map()
  for (let current = env; current; current = current.parent) {
    for (const { key, handle } of current.inspect().bindings) {
      if (key.startsWith("behaviors/") && !out.has(key)) out.set(key, { key, handle, own: current === env })
    }
  }
  return [...out.values()]
}

/** The url a request asks for: the value as put, or the package it was filled in with once mounted. */
function urlOf(value) {
  return typeof value === "string" ? value : value?.package
}

/** Writes what a request came to into its handle, once there is something to write. */
function fill(handle, found) {
  if (found) handle.change(() => found)
}
