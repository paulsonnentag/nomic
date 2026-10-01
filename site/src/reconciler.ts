// Serves `behaviors/<path>` requests: a binding whose value is a url asks for
// that behavior on the scope it is put on and on every fork below. The
// reconciler imports it and attaches it there; a new url at the key swaps it;
// a value that is not a url (or the key gone) detaches it.

import type { Env } from "./environment.js"
import { load } from "./registry.js"

export function reconcile(root: Env): () => void {
  const attached = new Map<Env, Map<string, string>>() // scope → request key → url attached there
  const pending = new Set<string>() // `${scope id} ${key} ${url}` being imported
  let scheduled = false
  const stop = root.subscribe(schedule)
  schedule()
  return () => {
    stop()
    for (const [scope, urls] of attached) for (const url of urls.values()) scope.detach(url)
    attached.clear()
  }

  function schedule() {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      run()
    })
  }

  /** Brings every scope under the root in line with its requests; forgets the scopes that are gone. */
  function run() {
    const seen = new Set<Env>()
    visit(root)
    for (const scope of [...attached.keys()]) if (!seen.has(scope)) attached.delete(scope) // destroyed: its behaviors went with it

    function visit(scope: Env) {
      seen.add(scope)
      sync(scope)
      for (const fork of scope.forks) visit(fork)
    }
  }

  function sync(scope: Env) {
    let have = attached.get(scope)
    if (!have) attached.set(scope, (have = new Map()))
    const wanted = requestsAt(scope)
    for (const [key, url] of [...have]) {
      if (wanted.has(key)) continue
      scope.detach(url)
      have.delete(key)
    }
    for (const [key, url] of wanted) {
      if (have.get(key) === url) continue
      const ticket = `${scope.id} ${key} ${url}`
      if (pending.has(ticket)) continue
      pending.add(ticket)
      load(url)
        .then((module) => {
          pending.delete(ticket)
          if (requestsAt(scope).get(key) !== url) return // asked for something else meanwhile
          const old = have!.get(key)
          if (old !== undefined) scope.detach(old)
          scope.attach(module.default, url)
          have!.set(key, url)
        })
        .catch((error) => {
          pending.delete(ticket)
          console.error(`[reconciler] ${url} failed to load for ${scope.id}`, error)
        })
    }
  }
}

/** The requests visible from `scope`, key → url: its own and those above it, the nearest binding of a key winning. Values that are not urls are ignored. */
function requestsAt(scope: Env): Map<string, string> {
  const out = new Map<string, string>()
  const seen = new Set<string>()
  for (let current: Env | undefined = scope; current; current = current.parent) {
    for (const [key, handle] of Object.entries(current.entries())) {
      if (!key.startsWith("behaviors/") || seen.has(key)) continue
      seen.add(key)
      const url = handle.value
      if (typeof url === "string" && url) out.set(key, url)
    }
  }
  return out
}
