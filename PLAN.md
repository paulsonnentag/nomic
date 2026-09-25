# Plan: host nomic packages in Automerge

This document is a complete brief for an agent working alone in this repository.
It contains every decision, format, API and reference fact needed. Repositories
it refers to (patchworld, pushwork, patchwork-next) are **not** required; the
relevant parts are quoted here.

## 0. Rules for the agent

- **Never run `nomic sync`, `nomic init`, `pushwork sync`, or anything that
  writes to a `.pushwork/` directory or talks to a sync server.** The human
  does the first sync and every sync after. Concurrent syncs of the same tree
  corrupt text files. Build everything so it is ready for the human to sync.
- Packages under `packages/` are **plain JavaScript, no build step, no
  TypeScript, no JSX**. `site/` and `cli/` are TypeScript.
- Code style (from the repo's rules): order functions top‑down (entry first,
  helpers below); use `type`, never `interface`; prettier config is in
  `.prettierrc.json` (`semi: false`, `trailingComma: "all"`, `printWidth: 120`).
  Run `yarn format` before finishing.
- Do not invent package versions. Use exactly the versions listed in §11 and
  §12; they are a known‑working combination copied from a sibling project.
- Keep test scaffolding out of `packages/` (everything there gets synced).
  Tests live in `cli/test/` and `test/`.
- Node ≥ 24 locally (type stripping runs `.ts` directly). CI uses Node 22 and
  only builds `site/`.

## 1. What nomic is

Nomic is an experiment in building a document editor out of **behaviors**.

- A **behavior** is a function `(env) => teardown | void`. It reads and writes
  named values in an **environment** and may return a cleanup function.
- An **environment** is a scope of named values (`env.get(key)`,
  `env.put(key, value)`), each value wrapped in a **handle**
  (`{ value, change(fn), subscribe(fn) }`). Environments **fork**; a fork sees
  its parent's values and can shadow them. Values put by a behavior are
  attributed to it and disappear when it detaches.
- A **view** shows a document: it forks the environment, puts the document
  handle at `data` and a fresh element at `dom`, and attaches behaviors.
- A **document** is JSON with `"@patchwork": { type: string, behaviors?: Url[] }`.
  Today there are two types: `canvas` (`{ shapes: { [id]: Shape } }`) and
  `line` (`{ x, y, points: [{x,y}], color }`), with lines nested inside a
  canvas's `shapes`.

The existing core is in `src/core/` (`environment.ts`, `handle.ts`,
`types.ts`); read them first — they are correct and get ported, not
redesigned. `src/core/environment.ts` is the important one: `Env` with
`get/put/entries/attach/fork/destroy`, attribution of puts to behaviors,
`live()` handles that follow shadowing, and a guard so `attach` is a no‑op
after `destroy`.

### The behaviors that exist (port these)

Currently in `packages/*/src/index.js(x)` (old layout, to be deleted) —
read them before porting:

| old package    | behavior     | what it does                                                                                                                 |
| -------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `pointer`      | `pointer`    | puts `surface = { pointers: { [id]: {x,y,buttons} } }`, kept in step with pointer events on `dom` (coords relative to `dom`) |
| `line-tool`    | `lineTool`   | subscribes to `surface`; press starts a `line` shape in `data.shapes`, moves append points; puts `drawing` (pointerId → id)  |
| `draw-shapes`  | `drawShapes` | renders every `data.shapes[id]` in `dom`, positioned by `x,y`, each as a nested `View` of the shape                          |
| `draw-line`    | `drawLine`   | renders `data.points` as an SVG polyline into `dom`                                                                          |
| `loader`       | `loader`     | decides which behaviors a view gets (rewritten in this plan)                                                                 |

Order matters: `pointer` must attach before `lineTool` (`env.get("surface")`
throws when nothing is visible at the key).

## 2. Target architecture in one paragraph

All package code lives in Automerge documents, synced from a `packages/`
checkout by the `nomic` CLI (built on pushwork), and served to the browser by
patchwork's service worker under `/<encoded pinned automerge url>/<path>`.
The site is a thin Vite shell that boots the service worker and the repo,
then imports `bootstrap.js` out of the root document. Packages import each
other with `/core`‑style specifiers resolved by import‑map scopes that core
injects at load time. A `manifest.json` in each package lists the behaviors it
provides and which document type each applies to. The loader (itself a
package) mounts, for a view, every applicable behavior from every package
under `components/`, plus any packages the document names in
`@patchwork.behaviors`.

## 3. Repository layout after this work

```
nomic/
├─ package.json            yarn v1 workspaces: ["site", "cli"]; scripts: dev, build, format, test
├─ .prettierrc.json        (keep)
├─ .gitignore              node_modules, dist, packages/.pushwork/, site/public/context.js
├─ .github/workflows/pages.yml   builds site (see §13)
├─ PLAN.md                 this file
├─ proposal.md             (leave as is)
├─ test/                   node:test tests for packages/core (imports ../packages/core/src/*)
├─ packages/               the pushwork checkout (plain JS)
│  ├─ bootstrap.js
│  ├─ core/                manifest.json, importmap.json, src/
│  ├─ loader/              manifest.json, importmap.json, src/index.js
│  ├─ frameworks/solid/    manifest.json, importmap.json, src/index.js
│  └─ components/
│     ├─ canvas/           manifest.json, importmap.json, src/{pointer,line-tool,draw-shapes}.js
│     └─ line/             manifest.json, importmap.json, src/draw-line.js
├─ site/                   Vite + patchwork bootloader shell (TypeScript)
└─ cli/                    `nomic` CLI (TypeScript, run directly by Node ≥ 24)
```

**Delete**: `src/`, `index.html`, `vite.config.ts`, `tsconfig.json` (root),
`scripts/`, the old `packages/{loader,pointer,line-tool,draw-shapes,draw-line}`,
and root `package.json` deps `vite`, `vite-plugin-solid`, `solid-js`.

## 4. Document formats (pushwork / patchwork conventions)

All are Automerge documents. URLs are `automerge:<base58 id>`; a **pinned**
URL appends heads: `automerge:<id>#<head1>|<head2>` (heads sorted, joined by
`|`). A pinned URL names an immutable snapshot; `repo.find(pinned)` returns a
read‑only view. Strip heads (`url.split("#")[0]`) to get the live document.

**Folder doc** (pushwork "patchwork-folder" shape; ordered):

```json
{ "@patchwork": { "type": "folder" }, "title": "components",
  "docs": [ { "name": "canvas", "type": "directory", "url": "automerge:…#h" },
            { "name": "line",   "type": "directory", "url": "automerge:…#h" } ],
  "lastSyncAt": 0 }
```

`type` is `"folder"` for subfolders, otherwise informational (file extension
or `"directory"`). pushwork stamps `lastSyncAt` on the root doc every sync;
never delete unknown keys when mutating folder docs.

**Directory doc** (pushwork "vfs" shape; one doc per package):

```json
{ "@patchwork": { "type": "directory", "title": "canvas" },
  "manifest.json": "automerge:…#h",
  "importmap.json": "automerge:…#h",
  "src/pointer.js": "automerge:…#h" }
```

Keys are posix paths relative to the package root; values are pinned file URLs.

**File doc** (`UnixFileEntry`):

```json
{ "@patchwork": { "type": "file" }, "name": "pointer.js", "extension": "js",
  "mimeType": "text/javascript", "content": "…" }
```

`content` is a string for text; for "artifact" files it is an
`ImmutableString` (read via `.val` or `String(content)`); binary is
`Uint8Array`. Read text as: `typeof c === "string" ? c : c?.val ?? String(c)`.

**Serving.** The patchwork service worker serves
`/${encodeURIComponent(pinnedUrl)}/${path}` by walking the doc: folder docs by
`docs[].name`, directory docs by longest‑prefix key match, file docs by
`content` with `mimeType`. Both folder and directory docs work.

## 5. Package format

A **package** is a directory containing `manifest.json`. Packages do not nest
(the sync shape stops descending at a package; everything below belongs to
it).

### `manifest.json`

```json
{
  "provides": {
    "pointer":     { "module": "./src/pointer.js",     "supportedDataType": "canvas" },
    "line-tool":   { "module": "./src/line-tool.js",   "supportedDataType": "canvas" },
    "draw-shapes": { "module": "./src/draw-shapes.js", "supportedDataType": "canvas" },
    "draw-line":   { "module": "./src/draw-line.js",   "supportedDataType": "line" }
  }
}
```

- `provides` is a flat map, **name → behavior**. Key order is attach order.
- Each `module` is one file whose **default export is one behavior**.
- `supportedDataType` omitted ⇒ applies to every document type.
- Library packages (`core`, `frameworks/solid`) have `{ "provides": {} }`.
- There is **no entry field**. Importers name the file they want (below).

### `importmap.json`

```json
{ "imports": { "/core": "automerge:3ifrVUqW…/src/index.js",
               "/frameworks/solid": "automerge:3KRZi7iD…/src/index.js" } }
```

- Keys starting with `/` are **paths under the packages root** (`/core` is the
  package at `packages/core`). The value is the package's **bare** directory‑doc
  URL followed by the module path (default `src/index.js`). The CLI's `install`
  fills/refreshes these values from the checkout; author them as `""` first.
- Other keys are external URLs (jspm CDN etc.), written by `nomic add`.
- `solid-js`, `solid-js/html`, `solid-js/web`, `solid-js/store`, `solid-js/h`,
  `solid-js/jsx-runtime` and the automerge packages are **provided top‑level by
  the patchwork bootloader's import map**. Never put them in `importmap.json`;
  import them bare.
- Optional `scopes` are merged verbatim (jspm style, keyed by CDN URLs).

### Source rules

- Imports between packages use the `/…` keys (`import { field } from "/core"`,
  subpaths `import x from "/core/handle.js"`).
- `core` is the boot edge: it may only use **relative** imports internally and
  no bare specifiers at all (it is imported before any import map exists).
- No JSX. Use `solid-js/html` tagged templates:
  `html\`<${Comp} prop=${() => v}>child<//>\`` — components close with `<//>`,
  reactive attributes are functions, children can be functions.

## 6. `packages/core` (plain JS)

Port `src/core/*.ts` to `packages/core/src/*.js` with no types, and add the
new modules. `src/index.js` re‑exports everything.

- `environment.js` — port of `src/core/environment.ts` unchanged in behavior.
- `handle.js` — `createHandle`, `field`, `isHandle` (port), plus:
  ```js
  /** A Handle over an automerge DocHandle. `change` mutates in place; a returned value is ignored. */
  export function fromDoc(handle) {
    return {
      url: handle.url,
      get value() { return handle.doc() },
      change(fn) { handle.change((doc) => { fn(doc) }) },
      subscribe(fn) {
        const listener = ({ doc }) => fn(doc)
        handle.on("change", listener)
        fn(handle.doc())
        return () => handle.off("change", listener)
      },
    }
  }
  ```
- `urls.js` — `headless(url)`, `isDocUrl(v)` (`/^automerge:[0-9A-Za-z]+(#[0-9A-Za-z|]+)?$/`),
  `pinOf(handle)` = `handle.view(handle.heads()).url`, `basePath(pin)` =
  `` `/${encodeURIComponent(pin)}` ``, `contentOf(fileDoc)` (text per §4),
  `splitTarget("automerge:X/src/a.js") → { url: "automerge:X", path: "src/a.js" }`
  (path defaults to `src/index.js`).
- `folder.js` — tree walking over folder docs:
  ```js
  /** The headless doc url at `path` under `root` (folder url or inline folder object); undefined if missing. */
  export async function docAt(repo, root, path)          // path: "components/canvas" or ["components","canvas"]
  /** The folder doc at `path` (follows urls; descends inline objects). */
  export async function folderAt(repo, root, path)
  /** The entries of the folder at `path`, in order: [{ name, type, url }]. */
  export async function entriesAt(repo, root, path)
  ```
  Walk by `docs.find((d) => d.name === segment)`, stripping heads at each hop.
  Inline objects (`{ docs: [...] }`) are accepted wherever a URL is, so a
  behavior can shadow `packages` with an in‑memory override.
- `load.js` — the **sole author of import maps** on the page.
  ```js
  export function createLoader(repo) {
    const snapshots = new Map()            // pin -> Promise<Snapshot>
    return async function load(packageUrl) {
      const handle = await repo.find(headless(packageUrl))
      const pin = pinOf(handle)
      let snapshot = snapshots.get(pin)
      if (!snapshot) snapshots.set(pin, (snapshot = makeImportable(repo, pin)))
      return snapshot
    }
  }
  // Snapshot = { url, pin, base, manifest, import(path) }  — import(path) = import(`${base}/${path}`)
  ```
  `makeImportable(repo, pin)`: read `manifest.json` and `importmap.json` from
  the pinned directory doc (`dir[path]` → file doc → text; missing importmap ⇒
  `{}`). Build one scope block for `` `${basePath(pin)}/` ``: for each
  `imports` entry whose value `isDocUrl`, `splitTarget` it, `load` the
  dependency recursively (cycle‑safe via a `visiting` set), and add
  `block[key] = `${dep.base}/${path}`` and `block[`${key}/`] = `${dep.base}/``;
  other values are copied verbatim. Merge `importmap.json.scopes` verbatim.
  Append `<script type="importmap">{"scopes": {...}}</script>` to
  `document.head` **before** anything from that base is imported. Import maps
  only accumulate; a base path is unique per snapshot so nothing is ever
  redefined. Browsers that support multiple/late import maps are required
  (Chrome/Safari; Firefox is explicitly not a concern).
- `mount.js` — the one rule:
  ```js
  /**
   * Mounts the package at `packageUrl` into the view `env`: attaches every provided behavior whose
   * supportedDataType is unset or equals the view's data type, in manifest order. Appends
   * { package, name } for each to `behaviors`. Returns a detach function.
   */
  export async function mount(env, packageUrl) {
    const load = env.get("load").value
    const type = env.get("data").value["@patchwork"].type
    const snapshot = await load(packageUrl)
    const applicable = Object.entries(snapshot.manifest.provides ?? {})
      .filter(([, b]) => !b.supportedDataType || b.supportedDataType === type)
    const modules = await Promise.all(applicable.map(([, b]) => snapshot.import(b.module.replace(/^\.\//, ""))))
    const detach = modules.map((m) => env.attach(m.default))
    const behaviors = env.get("behaviors", [])
    behaviors.change((list) => { for (const [name] of applicable) list.push({ package: headless(packageUrl), name }) })
    return () => detach.reverse().forEach((d) => d())
  }
  ```
  Load all modules in parallel, attach in order after all arrived (keeps the
  `pointer` → `lineTool` ordering and avoids half‑mounted views). `env.attach`
  after `destroy` is already a no‑op.

Environment contents:

```
root
├─ repo       page-side automerge Repo
├─ packages   headless Url of the root folder doc (or an inline folder for overrides)
└─ load       createLoader(repo)

view — fork
├─ data       Handle of the document (fromDoc, or field() into a parent doc)
├─ dom        the view's element
└─ behaviors  [{ package, name }]   written by mount()
```

## 7. `packages/loader`

`manifest.json`: `{ "provides": { "loader": { "module": "./src/index.js" } } }`
(no `supportedDataType` — it applies to every view). `importmap.json`:
`{ "imports": { "/core": "" } }` (filled by `nomic install`).

```js
import { entriesAt, mount } from "/core"

/** Mounts every package under `components/`, in folder order, then the packages the document names. */
export default function loader(env) {
  const detach = []
  let cancelled = false
  run().catch(console.error)
  return () => { cancelled = true; detach.reverse().forEach((d) => d()) }

  async function run() {
    const repo = env.get("repo").value
    const root = env.get("packages").value
    const meta = env.get("data").value["@patchwork"]
    const components = await entriesAt(repo, root, "components")
    const urls = [...components.map((e) => e.url), ...(meta.behaviors ?? [])]
    for (const url of urls) {
      const d = await mount(env, url)          // sequential: keeps cross-package order deterministic
      if (cancelled) return d()
      detach.push(d)
    }
  }
}
```

## 8. `packages/frameworks/solid`

`{ "provides": {} }`; `importmap.json` `{ "imports": { "/core": "" } }`.
Imports `solid-js`, `solid-js/web`, `solid-js/html` bare (page‑provided).

```js
export function View(props)            // { env, data } → element; forks, puts data/dom, mounts the loader, destroys on onCleanup
export function useHandle(handle)      // signal following a handle (equals: false), port of src/frameworks/solid/useHandle.ts
export function mountRoot(env, data, element)   // render(() => View({ env, data }), element); returns dispose
```

`View`:

```js
import { onCleanup } from "solid-js"
import { docAt, mount } from "/core"

export function View(props) {
  const dom = document.createElement("div")
  dom.className = props.data.value["@patchwork"].type
  const env = props.env.fork()
  env.put("data", props.data)
  env.put("dom", dom)
  mountLoader(env).catch(console.error)
  onCleanup(() => env.destroy())
  return dom
}

async function mountLoader(env) {
  const repo = env.get("repo").value
  const url = await docAt(repo, env.get("packages").value, "loader")
  if (!url) throw new Error("no loader package")
  await mount(env, url)
}
```

## 9. `packages/components/canvas` and `packages/components/line`

`importmap.json` for both: `{ "imports": { "/core": "", "/frameworks/solid": "" } }`.

Port the four behaviors to plain JS. Styles were in `src/styles.css`; there is
no stylesheet anymore, so set them inline where the element is created:

- `pointer.js` — as today; additionally `Object.assign(dom.style, { touchAction: "none", userSelect: "none" })`.
- `line-tool.js` — as today (`crypto.randomUUID()` ids, `start(x, y)` line doc).
- `draw-shapes.js` — as today but with `solid-js/html`:
  ```js
  import { For } from "solid-js"
  import { render } from "solid-js/web"
  import html from "solid-js/html"
  import { field } from "/core"
  import { View, useHandle } from "/frameworks/solid"

  export default function drawShapes(env) {
    const dom = env.get("dom").value
    const data = env.get("data")
    Object.assign(dom.style, { position: "relative", width: "640px", height: "480px", background: "white",
      border: "2px solid #4a8cf7", borderRadius: "4px", overflow: "hidden" })
    return render(() => {
      const canvas = useHandle(data)
      return html`<${For} each=${() => Object.keys(canvas().shapes)}>${(id) => {
        const shape = field(data, "shapes", id)
        const s = useHandle(shape)
        return html`<div style=${() => `position:absolute;left:0;top:0;pointer-events:none;transform:translate(${s().x}px,${s().y}px)`}>
          ${View({ env, data: shape })}
        </div>`
      }}<//>`
    }, dom)
  }
  ```
- `draw-line.js` — svg via `html`; svg element styles `display:block;width:1px;height:1px;overflow:visible`; polyline `points`/`stroke` reactive.

`field(data, "shapes", id)` works on automerge change proxies because it
mutates in place inside `root.change`.

## 10. `packages/bootstrap.js`

Served from the root folder doc; runs before any import map exists, so it
walks the root doc with the repo directly, pins `core`, imports it by served
URL, and hands off.

```js
const ROOT = decodeURIComponent(new URL(import.meta.url).pathname.split("/")[1]).split("#")[0]

export default function boot(element, repo) {
  run(element, repo).catch((error) => console.error("[bootstrap] boot failed", error))
}

async function run(element, repo) {
  const coreUrl = await linkUrl(repo, ROOT, "core")            // folder link → headless directory-doc url
  const coreHandle = await repo.find(coreUrl)
  const pin = coreHandle.view(coreHandle.heads()).url
  const core = await import(`/${encodeURIComponent(pin)}/src/index.js`)

  const env = core.createEnvironment()
  env.put("repo", repo)
  env.put("packages", ROOT)
  env.put("load", core.createLoader(repo))

  const solidUrl = await core.docAt(repo, ROOT, "frameworks/solid")
  const solid = await (await env.get("load").value(solidUrl)).import("src/index.js")
  const canvas = await canvasDoc(repo)                             // from location.hash, or create and set the hash
  solid.mountRoot(env, core.fromDoc(canvas), element)
}

async function linkUrl(repo, folderUrl, name) { /* docs.find(name).url, heads stripped */ }
async function canvasDoc(repo) {
  const url = location.hash.slice(1)
  if (url) return repo.find(url)
  const handle = repo.create({ "@patchwork": { type: "canvas" }, shapes: {} })
  location.hash = handle.url
  return handle
}
```

## 11. `site/` — the shell

Copy of a known‑working sibling site. Files:

`site/package.json`

```json
{ "name": "site", "private": true, "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "check": "tsc --noEmit" },
  "dependencies": {
    "@automerge/automerge-repo": "2.6.0-subduction.47",
    "@automerge/automerge-repo-network-messagechannel": "2.6.0-subduction.47",
    "@inkandswitch/patchwork": "0.7.3",
    "@inkandswitch/patchwork-bootloader": "0.6.2" },
  "devDependencies": { "typescript": "^5.6.0", "vite": "^8.2.0" } }
```

`site/vite.config.ts`

```ts
import patchwork from "@inkandswitch/patchwork/vite"
import { defineConfig } from "vite"
export default defineConfig({
  plugins: patchwork({ html: false, icons: false, manifest: false, netlify: false, storagePrefix: "nomic" }),
})
```

`site/index.html` — `<main id="root"></main>` + `<script type="module" src="/src/main.ts">`;
**no import map in the HTML** (the bootloader injects the externals map, core injects scopes).

`site/src/main.ts`

```ts
import setupServiceWorker from "@inkandswitch/patchwork-bootloader"
import type { SetupServiceWorkerResult } from "@inkandswitch/patchwork-bootloader/types"
import { createRepo, initWasm } from "@inkandswitch/patchwork"
import type { Repo } from "@automerge/automerge-repo"
import { MessageChannelNetworkAdapter } from "@automerge/automerge-repo-network-messagechannel"

/** The packages root folder doc — the only hardcoded url. Filled in after the first `nomic init`. */
const PACKAGES_ROOT_URL = ""

await main()

async function main() {
  if (!PACKAGES_ROOT_URL) { document.getElementById("root")!.textContent = "Set PACKAGES_ROOT_URL in site/src/main.ts"; return }
  const sw = await setupServiceWorker()
  const repo = await setupRepo(sw)
  const module = await import(/* @vite-ignore */ `/${encodeURIComponent(PACKAGES_ROOT_URL)}/bootstrap.js`)
  module.default(document.getElementById("root"), repo)
}

async function setupRepo(sw: SetupServiceWorkerResult): Promise<Repo> {
  await initWasm()
  let repo: Repo | undefined
  const port: MessagePort = await new Promise((resolve) => {
    let first = true
    sw.subscribeToRepoChannel((freshPort) => {
      if (first) { first = false; resolve(freshPort) }
      else repo?.networkSubsystem.addNetworkAdapter(new MessageChannelNetworkAdapter(freshPort))
    })
  })
  ;({ repo } = await createRepo(new MessageChannelNetworkAdapter(port)))
  return repo
}
```

`site/tsconfig.json`: `target/module ESNext`, `moduleResolution bundler`,
`strict`, `noEmit`, `lib: ["ES2022","DOM","DOM.Iterable"]`, `types: ["vite/client"]`,
include `src`. `site/public/context.js` is generated by the patchwork plugin — gitignore it.

## 12. `cli/` — the `nomic` command

TypeScript, executed directly by Node ≥ 24 (`#!/usr/bin/env node` on
`main.ts`; only erasable TS syntax — no enums, no parameter properties).

`cli/package.json`

```json
{ "name": "nomic", "version": "0.1.0", "private": true, "type": "module",
  "bin": { "nomic": "./main.ts" },
  "engines": { "node": ">=24" },
  "scripts": { "test": "node --test test/" },
  "dependencies": { "pushwork": "^2.2.3", "commander": "^15.0.0", "@jspm/generator": "^2.16.3" },
  "devDependencies": { "@types/node": "^24.0.0", "typescript": "^5.6.0" } }
```

pushwork is a normal dependency; nothing relies on a global install.

### pushwork facts the CLI relies on

Programmatic API from `import { init, sync, pinUrl, stripHeads } from "pushwork"`:

```ts
init(opts: { dir: string; backend: "subduction" | "legacy"; shape: string; artifactDirectories?: string[]; online?: boolean },
     report?: (phase: string) => void, warn?: (message: string) => void): Promise<{ url: AutomergeUrl; files: number; sync?: … }>
sync(cwd: string, opts?: { nuclear?: boolean }, report?, warn?): Promise<…>
pinUrl(handle): AutomergeUrl          // at-heads url of a handle
stripHeads(url): AutomergeUrl
```

- `shape` is either `"vfs"`, `"patchwork-folder"`, or an **absolute path to a
  module** whose default export is `{ encode, decode }`. pushwork imports it
  with `import(pathToFileURL(path))` and **persists the string in
  `.pushwork/config.json`** (`{ version: 5, rootUrl, backend, shape, artifactDirectories }`).
  `sync` re‑reads the shape from that config; there is no override.
- The `Shape` contract:
  ```ts
  type VfsNode = { kind: "dir"; entries: Map<string, VfsNode> } | { kind: "file"; url: AutomergeUrl }
  type Shape = {
    encode(args: { repo: Repo; tree: VfsNode; previousRoot?: DocHandle<unknown>; title?: string }): Promise<AutomergeUrl>
    decode(args: { repo: Repo; root: DocHandle<unknown> }): Promise<VfsNode>
  }
  ```
  File leaves arrive **already created and heads‑pinned**; the shape only lays
  out directories. With `previousRoot` it must mutate the existing root in
  place (the root URL is the repo's identity). `repo.find(pinned)` yields a
  read‑only view, so strip heads before `handle.change`.
- pushwork always ignores `.pushwork`, `.git`, `node_modules`, and honors a
  `.pushworkignore` (gitignore syntax) at the checkout root.
- Root doc gets `lastSyncAt` stamped by pushwork; preserve it.

### `cli/shape.js` — the nomic shape (plain JS so pushwork can import it)

```
encode(tree):
  encodeFolder(name, dirNode, existingFolderHandle?) → folder doc
    for each entry (sorted by name):
      file           → link { name, type: extension|"file", url: leaf url (already pinned) }
      dir with a "manifest.json" file entry → package: encodeDirectory(name, dir, existingDirHandle?) → link { name, type: "directory", url: pinUrl(dirHandle) }
      other dir      → encodeFolder(...) → link { name, type: "folder", url: pinUrl(folderHandle) }
    reuse: match existing links by name (stripHeads(link.url) → repo.find → handle); create fresh docs otherwise
    write only when links changed (compare name/type/url arrays), preserving unknown keys (lastSyncAt)
  encodeDirectory(name, dirNode, existing?) → directory doc { "@patchwork": { type: "directory", title: name }, [posixPath]: pinnedFileUrl }
    flatten leaves (walkLeaves); delete keys not present anymore (except "@patchwork"); set changed ones
  root is always a folder doc (title = args.title ?? "packages")
decode(root): inverse — folder docs recurse; directory docs expand flat keys into nested dirs
record: while encoding/decoding, fill an exported `recorded: Map<string, string>` of path → headless doc url
        for every folder and package ("" for root, "core", "components/canvas", …)
```

`recorded` is how `nomic` learns package URLs: after `init`/`sync` it writes
`.pushwork/nomic-tree.json` (`{ "": rootUrl, "core": "automerge:…", … }`).
The shape module and the CLI run in the same process, and pushwork imports the
shape by the same file URL the CLI can import, so the module instance (and its
`recorded` map) is shared. Import `pinUrl`/`stripHeads` from `"pushwork"`.

### Commands

- `nomic init [dir]` — `init({ dir, backend: "subduction", shape: SHAPE_PATH, artifactDirectories: [] })`,
  then write the sidecar and print the root URL with a reminder to paste it
  into `site/src/main.ts`. `SHAPE_PATH = fileURLToPath(new URL("./shape.js", import.meta.url))`.
- `nomic sync [dir]` — read `.pushwork/config.json`; if `shape !== SHAPE_PATH`
  rewrite it (the CLI may have moved); `sync(dir)`; write the sidecar.
- `nomic install [dir]` — find packages under `dir` (directories containing
  `manifest.json`; don't descend into them; skip dot‑dirs and `node_modules`).
  For each package with an `importmap.json`, for every key starting with `/`:
  look up `key.slice(1)` in the sidecar (error naming the key if missing: "run
  `nomic sync` first"); keep the module path from the current value if it has
  one (`automerge:X/src/a.js` → `src/a.js`), else `src/index.js`; write
  `${url}/${path}`. Sort keys; print what changed. Fails clearly when there is
  no sidecar.
- `nomic add <specs...>` — in the current package: `@jspm/generator` with
  `{ mapUrl: pathToFileURL(importmap.json), inputMap: map without "/" keys, defaultProvider: "jspm.io", env: ["browser","production","module"], flattenScopes: false }`,
  `await generator.install(specs)`, merge the `/` keys back, sort keys, write.
  Exact versions only (`name@1.2.3`), bare names resolve latest. Warn if a spec
  is page‑provided (`solid-js*`, `@automerge/*`).
- `nomic url <path>` — print the sidecar entry (`""`/`.` for the root).

Shared helpers: `readJson`, `writeJson` (2‑space, trailing newline), `sortKeys`,
`findPackages(base)`, `sidecarPath(root)`, `checkoutRootOf(dir)` (nearest
ancestor with `.pushwork/`).

### CLI tests (`cli/test/`, `node --test`)

- `shape.test.ts`: in‑memory fake repo (`create(doc) → handle`, `find(url)`,
  handles with `url`, `doc()`, `change(fn)`, `heads()` returning a counter
  string so `pinUrl` changes on every change) — encode a tree with a root file,
  a plain folder, and two packages; assert doc shapes, link order, `recorded`;
  decode and assert the tree round‑trips; re‑encode with `previousRoot` after
  changing one file and assert package/folder URLs are unchanged and unrelated
  folder docs were not rewritten. Note: `pinUrl` from pushwork calls
  `parseAutomergeUrl`, which validates real base58 ids — either generate valid
  ids in the fake (copy an id format like `automerge:3ifrVUqWHrTPGQQhdK2XqmVrJseE`
  and vary characters) or inject the pin function.
- `install.test.ts`: temp dir with a sidecar and two packages; assert values
  are filled, module paths preserved, missing keys error.

## 13. Root files

`package.json`

```json
{ "name": "nomic", "private": true, "version": "0.0.1", "type": "module",
  "workspaces": ["site", "cli"],
  "scripts": { "dev": "yarn workspace site dev", "build": "yarn workspace site build",
               "test": "node --test test/ && yarn workspace nomic test",
               "format": "prettier --write .", "format:check": "prettier --check ." },
  "devDependencies": { "prettier": "^3.3.3" } }
```

`.github/workflows/pages.yml`: keep the job, change the upload path to
`site/dist`. Note in a comment that the service worker must be served from the
site root, so a GitHub Pages sub‑path deployment will not boot; deploying to a
custom domain root is required for a live site. Do not spend time making the
sub‑path work.

`test/` (root): `node --test` tests for `packages/core/src/*` — port the
behaviors of `environment.ts` into assertions (get/put/fork shadowing,
attribution and drop on detach, attach after destroy is a no‑op, `field`
write‑through), plus `splitTarget`, `folder.js` walks over inline folder
objects and over a fake repo, and `mount` with a fake `load` (returns a
snapshot whose `import(path)` yields modules from an in‑memory map) asserting
the type filter, ordering and `behaviors` entries. Stub `document` only where
`load.js` is under test (its import‑map injection), or test `collectScopes`
separately from injection by keeping them separate functions.

## 14. Verification the agent can do (and cannot)

Can:

- `node --check` every `.js` under `packages/`.
- `yarn install` at the root; `yarn workspace site build`; `yarn workspace site check`.
- `yarn test` (root core tests + cli tests).
- `yarn format:check`.
- `node cli/main.ts --help`, `node cli/main.ts install packages` against a
  hand‑written temporary sidecar in a **copy** of `packages/` under `/tmp` (never
  create `.pushwork/` inside the repo).

Cannot (leave to the human, and say so in the final report):

- Any sync. Therefore the browser end‑to‑end (service worker → import maps →
  behaviors) cannot be exercised by the agent. Compensate with the unit tests
  above and by keeping `load.js`/`mount.js`/`bootstrap.js` small and literal.

## 15. Handover: what the human runs afterwards

1. `cd packages && node ../cli/main.ts init` (or `yarn nomic init` if a root
   script is added) — mints all docs, writes `.pushwork/`, prints the root URL.
2. `node ../cli/main.ts install` — fills every `/…` entry in the
   `importmap.json` files from the minted URLs.
3. `node ../cli/main.ts sync` — publishes the filled import maps.
4. Paste the root URL into `site/src/main.ts` `PACKAGES_ROOT_URL`; `yarn dev`.
5. Loop: edit under `packages/` → `nomic sync` → reload.

## 16. Decisions already made (do not reopen)

- Folder of view packages is `components/`; the loader is its own root package `loader/`.
- No build step; packages are plain JS; Solid via `solid-js/html`.
- `importmap.json` values are always URLs (never paths), with the module path appended.
- `manifest.json` has only `provides`; flat; `supportedDataType` is a single string; one behavior per module (default export).
- `core` uses relative imports only; everything else uses `/…` keys and bare page‑provided specifiers.
- The CLI bundles pushwork as a dependency and calls its programmatic API in‑process.
- Firefox support is not a requirement.
