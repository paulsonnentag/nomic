import { basePath, contentOf, headless, isDocUrl, pinOf, splitTarget } from "./urls.js"

/**
 * Loads packages by pinning them and serving them through the page's import maps.
 * `load(packageUrl)` resolves to a snapshot `{ url, pin, base, manifest, import(path) }`
 * once the snapshot and every package it imports have their scopes on the page.
 */
export function createLoader(repo) {
  const snapshots = new Map() // pin -> Promise<Snapshot>

  return async function load(packageUrl) {
    return ready(packageUrl, new Set())
  }

  /** The snapshot of `packageUrl`, with the scopes of its whole import graph injected (cycle-safe via `visiting`). */
  async function ready(packageUrl, visiting) {
    const snapshot = await snapshotOf(packageUrl)
    if (visiting.has(snapshot.pin)) return snapshot
    visiting.add(snapshot.pin)
    for (const dependency of snapshot.dependencies) await ready(dependency, visiting)
    return snapshot
  }

  /** One snapshot per pin: made once, then shared. */
  async function snapshotOf(packageUrl) {
    const handle = await repo.find(headless(packageUrl))
    const pin = pinOf(handle)
    let snapshot = snapshots.get(pin)
    if (!snapshot) snapshots.set(pin, (snapshot = makeImportable(repo, pin)))
    return snapshot
  }
}

/**
 * Reads the pinned package's manifest and import map, injects its scope and
 * returns the snapshot. Dependencies are named, not loaded: `createLoader`
 * loads them, so a cycle between packages cannot deadlock here.
 */
export async function makeImportable(repo, pin) {
  const dir = (await repo.find(pin)).doc()
  const manifest = JSON.parse(await fileText(repo, dir, "manifest.json"))
  const importmap = dir["importmap.json"] ? JSON.parse(await fileText(repo, dir, "importmap.json")) : {}
  const base = basePath(pin)
  const { scopes, dependencies } = await collectScopes(repo, base, importmap)
  injectImportMap({ scopes })
  return {
    url: headless(pin),
    pin,
    base,
    manifest,
    dependencies,
    import: (path) => import(`${base}/${path}`),
  }
}

/**
 * The scope block for `base` from a package's import map: every `/…` key whose
 * value names a document becomes `{ key: dep/path, "key/": dep/ }` for the pinned
 * dependency; other values are copied verbatim; `importmap.scopes` merge verbatim.
 * Also returns the dependency urls, so the caller can load them.
 */
export async function collectScopes(repo, base, importmap) {
  const block = {}
  const dependencies = []
  for (const [key, value] of Object.entries(importmap.imports ?? {})) {
    if (typeof value !== "string" || value === "") continue
    const { url, path } = splitTarget(value)
    if (!isDocUrl(url)) {
      block[key] = value
      continue
    }
    const handle = await repo.find(headless(url))
    const dep = basePath(pinOf(handle))
    block[key] = `${dep}/${path}`
    block[`${key}/`] = `${dep}/`
    dependencies.push(headless(url))
  }
  const scopes = { ...(importmap.scopes ?? {}), [`${base}/`]: block }
  return { scopes, dependencies }
}

/** Appends an import map to the page. Maps only accumulate: every base is unique, so nothing is redefined. */
export function injectImportMap(map) {
  const script = document.createElement("script")
  script.type = "importmap"
  script.textContent = JSON.stringify(map)
  document.head.appendChild(script)
}

/** The text of the file at `path` in a directory document. */
async function fileText(repo, dir, path) {
  const url = dir[path]
  if (typeof url !== "string") throw new Error(`no "${path}" in ${dir["@patchwork"]?.title ?? "package"}`)
  return contentOf((await repo.find(url)).doc())
}
