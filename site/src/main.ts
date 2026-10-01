import setupServiceWorker, { bumpServiceWorkerCache } from "@inkandswitch/patchwork-bootloader"
import type { SetupServiceWorkerResult } from "@inkandswitch/patchwork-bootloader/types"
import { createRepo, initWasm } from "@inkandswitch/patchwork"
import type { Repo as AutomergeRepo } from "@automerge/automerge-repo"
import { MessageChannelNetworkAdapter } from "@automerge/automerge-repo-network-messagechannel"
import { createEnvironment, type Env } from "./environment.js"
import type { Handle } from "./handle.js"
import { behaviors } from "./loader.js"
import { reconcile } from "./reconciler.js"
import { wrap, type Repo } from "./repo.js"

// Dev escape hatch: the service worker caches every automerge url it serves for
// good, so run `bumpServiceWorkerCache()` in the console and reload to boot
// from a fresh cache without clearing site data.
Object.assign(window, { bumpServiceWorkerCache })

await main()

async function main() {
  const sw = await setupServiceWorker()
  const repo = wrap(await setupRepo(sw))

  const root = createEnvironment()
  root.put("repo", repo)
  reconcile(root)
  request(root, behaviors())
  // A behavior file changed: the loader is re-evaluated with new urls and every behavior is swapped.
  import.meta.hot?.accept("./loader.js", (loader) => {
    if (loader) request(root, (loader as unknown as typeof import("./loader.js")).behaviors())
  })

  const workspace = await workspaceDoc(repo)
  show(root, workspace, document.getElementById("root")!)
  Object.assign(window, { root })
}

/** Asks the root for every behavior found, and withdraws the requests of those gone. */
function request(root: Env, found: Map<string, string>) {
  for (const key of Object.keys(root.entries())) {
    if (key.startsWith("behaviors/") && !found.has(key.slice("behaviors/".length))) root.put(key, null)
  }
  for (const [path, url] of found) root.put(`behaviors/${path}`, url)
}

/** Shows `data` in a fork of `env` inside `element`: what `View` does, without Solid, for the one view the page starts with. */
function show(env: Env, data: Handle, element: HTMLElement) {
  const view = env.fork(data.url ?? "document")
  view.put("data", data)
  view.put("dom", null)
  view.get("dom").subscribe((dom) => {
    if (dom instanceof Node) element.replaceChildren(dom)
    else element.replaceChildren()
  })
}

/** The workspace named by the location hash, or a fresh one (a canvas with the tools, on a `main` branch) that the hash is set to. */
async function workspaceDoc(repo: Repo): Promise<Handle> {
  const url = location.hash.slice(1)
  if (url) return repo.find(url)
  const canvas = repo.create({ "@patchwork": { type: "canvas" }, shapes: seed() })
  const main = repo.create({ "@patchwork": { type: "branch" }, name: "main", docs: {} })
  const workspace = repo.create({
    "@patchwork": { type: "workspace" },
    root: canvas.url,
    branches: [main.url],
    current: main.url,
  })
  location.hash = workspace.url
  return workspace
}

/** A new canvas's shapes: the tools in a column at the top left and the branch picker beside them, locked and above everything. */
function seed() {
  const side = 40 // px, a tool's square
  const gap = 8
  const shapes: Record<string, unknown> = {}
  for (const [i, tool] of ["select", "pen", "inspect"].entries()) {
    const id = crypto.randomUUID()
    shapes[id] = {
      "@patchwork": { type: "tool" },
      id,
      tool,
      label: tool,
      locked: true,
      x: gap,
      y: gap + i * (side + gap),
      z: 10,
      outline: rect(side, side),
    }
  }
  const picker = crypto.randomUUID()
  shapes[picker] = {
    "@patchwork": { type: "branch-picker" },
    id: picker,
    locked: true,
    x: gap + side + gap,
    y: gap,
    z: 10,
    outline: rect(260, 28),
  }
  return shapes
}

function rect(w: number, h: number) {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
    { x: 0, y: 0 },
  ]
}

/** The page-side repo, talking to the automerge worker over the ports the service worker hands out. */
async function setupRepo(sw: SetupServiceWorkerResult): Promise<AutomergeRepo> {
  await initWasm()
  let repo: AutomergeRepo | undefined
  const port: MessagePort = await new Promise((resolve) => {
    let first = true
    sw.subscribeToRepoChannel((freshPort) => {
      if (first) {
        first = false
        resolve(freshPort)
      } else repo?.networkSubsystem.addNetworkAdapter(new MessageChannelNetworkAdapter(freshPort))
    })
  })
  ;({ repo } = await createRepo(new MessageChannelNetworkAdapter(port)))
  return repo
}
