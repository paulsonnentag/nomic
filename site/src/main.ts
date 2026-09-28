import setupServiceWorker, { bumpServiceWorkerCache } from "@inkandswitch/patchwork-bootloader"
import type { SetupServiceWorkerResult } from "@inkandswitch/patchwork-bootloader/types"
import { createRepo, initWasm } from "@inkandswitch/patchwork"
import type { AutomergeUrl, Repo } from "@automerge/automerge-repo"
import { MessageChannelNetworkAdapter } from "@automerge/automerge-repo-network-messagechannel"

/** The packages root folder doc — the only hardcoded url. Filled in after `pushwork init` (its printed url, or `nomic url .`). */
const PACKAGES_ROOT_URL = "automerge:2Sgy8MTkTyZumeW6dxjaSXswVnyT" as AutomergeUrl

// Dev escape hatch: the service worker caches every automerge url it serves for
// good, so run `bumpServiceWorkerCache()` in the console and reload to boot
// from a fresh cache without clearing site data.
Object.assign(window, { bumpServiceWorkerCache })

await main()

async function main() {
  const sw = await setupServiceWorker()
  const repo = await setupRepo(sw)
  // Pinned at the root's current heads: the service worker caches what it serves forever, so an
  // unpinned url would keep serving the first bootstrap.js it saw. Pinned urls are content-addressed.
  const root = await repo.find(PACKAGES_ROOT_URL)
  const pin = root.view(root.heads()).url
  const module = await import(/* @vite-ignore */ `/${encodeURIComponent(pin)}/bootstrap.js`)
  module.default(document.getElementById("root"), repo)
}

/** The page-side repo, talking to the automerge worker over the ports the service worker hands out. */
async function setupRepo(sw: SetupServiceWorkerResult): Promise<Repo> {
  await initWasm()
  let repo: Repo | undefined
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
