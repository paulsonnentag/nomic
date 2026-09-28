import setupServiceWorker from "@inkandswitch/patchwork-bootloader"
import type { SetupServiceWorkerResult } from "@inkandswitch/patchwork-bootloader/types"
import { createRepo, initWasm } from "@inkandswitch/patchwork"
import type { Repo } from "@automerge/automerge-repo"
import { MessageChannelNetworkAdapter } from "@automerge/automerge-repo-network-messagechannel"

/** The packages root folder doc — the only hardcoded url. Filled in after `pushwork init` (its printed url, or `nomic url .`). */
const PACKAGES_ROOT_URL = "automerge:2Sgy8MTkTyZumeW6dxjaSXswVnyT"

await main()

async function main() {
  const sw = await setupServiceWorker()
  const repo = await setupRepo(sw)
  const module = await import(/* @vite-ignore */ `/${encodeURIComponent(PACKAGES_ROOT_URL)}/bootstrap.js`)
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
