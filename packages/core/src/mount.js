import { basePath, contentOf, headless, isDocUrl, pinOf, splitTarget } from "./urls.js"

/**
 * Mounts the package at `packageUrl` into the view `env`: resolves the package's
 * imports, then attaches every provided behavior whose supportedDataType is
 * unset or equals the view's data type, in manifest order, through a layer
 * holding those imports at `imports`. Records { package, name } for each in
 * `behaviors` when the view keeps such a list. Returns a detach function.
 */
export async function mount(env, packageUrl) {
  const repo = env.get("repo").value
  const type = env.get("data").value["@patchwork"].type
  const pkg = await snapshot(repo, packageUrl)
  const imports = await resolveImports(env, pkg, [pkg.pin])
  const applicable = Object.entries(pkg.manifest.provides ?? {}).filter(
    ([, b]) => !b.supportedDataType || b.supportedDataType === type,
  )
  // Every module arrives before any attaches: the manifest order holds and a view is never half mounted.
  const modules = await Promise.all(applicable.map(([, b]) => pkg.import(b.module)))
  const layer = env.layer({ imports })
  const detach = modules.map((m) => layer.attach(m.default))
  const behaviors = env.get("behaviors")
  if (behaviors.value) {
    behaviors.change((list) => {
      for (const [name] of applicable) list.push({ package: headless(packageUrl), name })
    })
  }
  return () => detach.reverse().forEach((d) => d())
}

/**
 * The value an import map entry stands for: the module at `target` (an
 * `automerge:…/path` or an external url). A module whose default export is a
 * function is a library: it is called with a layer holding its own imports, and
 * the result is the value. Any other module is the value itself.
 */
export async function resolve(env, target, visiting = []) {
  const { url, path } = splitTarget(target)
  if (!isDocUrl(url)) return import(target)
  const pkg = await snapshot(env.get("repo").value, url)
  if (visiting.includes(pkg.pin)) throw new Error(`import cycle at ${target}`)
  const module = await pkg.import(path)
  if (typeof module.default !== "function") return module
  const imports = await resolveImports(env, pkg, [...visiting, pkg.pin])
  return module.default(env.layer({ imports }))
}

/** The package's import map, resolved: name → value. Entries not yet installed (no url) are skipped with a warning. */
async function resolveImports(env, pkg, visiting) {
  const entries = Object.entries(pkg.importmap.imports ?? {}).filter(([name, target]) => {
    if (typeof target === "string" && target && !target.startsWith("/")) return true
    console.warn(`[mount] ${pkg.url}: import "${name}" is not installed (run \`nomic install\`)`)
    return false
  })
  const values = await Promise.all(entries.map(([, target]) => resolve(env, target, visiting)))
  return Object.fromEntries(entries.map(([name], i) => [name, values[i]]))
}

const snapshots = new Map() // pin -> Promise<Snapshot>

/** The package at `packageUrl` pinned at its current heads: manifest, import map and a way to import its files. */
async function snapshot(repo, packageUrl) {
  const handle = await repo.find(headless(packageUrl))
  const pin = pinOf(handle)
  let pending = snapshots.get(pin)
  if (!pending) snapshots.set(pin, (pending = read(repo, pin)))
  return pending
}

async function read(repo, pin) {
  const dir = (await repo.find(pin)).doc()
  const manifest = JSON.parse(await fileText(repo, dir, "manifest.json"))
  const importmap = dir["importmap.json"] ? JSON.parse(await fileText(repo, dir, "importmap.json")) : {}
  if (importmap.scopes) injectImportMap({ scopes: importmap.scopes }) // external packages may bring jspm scopes
  const base = basePath(pin)
  return {
    url: headless(pin),
    pin,
    base,
    manifest,
    importmap,
    import: (path) => import(`${base}/${path.replace(/^\.\//, "")}`),
  }
}

/** Appends an import map to the page. Maps only accumulate; a snapshot's scopes are injected once. */
function injectImportMap(map) {
  const script = document.createElement("script")
  script.type = "importmap"
  script.textContent = JSON.stringify(map)
  document.head.appendChild(script)
}

async function fileText(repo, dir, path) {
  const url = dir[path]
  if (typeof url !== "string") throw new Error(`no "${path}" in ${dir["@patchwork"]?.title ?? "package"}`)
  return contentOf((await repo.find(url)).doc())
}
