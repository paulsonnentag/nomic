// The behaviors on disk: every `packages/<path>/index.js`, served by vite.
// Each evaluation of this module is one version of the tree: the urls carry
// it, so a code change (which re-evaluates this module through hot reloading)
// gives every behavior a new url and the reconciler swaps them all.
//
// Loading from a synced automerge tree replaces this module; the interface
// stays: `behaviors()` maps a path to a url the registry can import.

import { register } from "./registry.js"

const modules = import.meta.glob("../../packages/**/index.js")
const version = Date.now().toString(36)

/** Every behavior in the tree: path (`pen/pen`) → url. */
export function behaviors(): Map<string, string> {
  const out = new Map<string, string>()
  for (const [file, load] of Object.entries(modules)) {
    const path = file.replace(/^(\.\.\/)+packages\//, "").replace(/\/index\.js$/, "")
    const url = `/packages/${path}/index.js?v=${version}`
    register(url, load)
    out.set(path, url)
  }
  return out
}
