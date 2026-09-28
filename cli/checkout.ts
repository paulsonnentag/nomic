// Reading a pushwork checkout's documents offline: the packages folder tree
// is `patchwork-folder` docs ({ title, docs: [{ name, type, url }] }), and a
// package is a folder that holds a manifest.json.

import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import type { PushworkConfig } from "pushwork"

// pushwork's public entry exports only its commands; opening the store lives in
// its dist. Requiring those files by path sidesteps the package's `exports`.
const require = createRequire(import.meta.url)
const dist = dirname(require.resolve("pushwork"))
const { openRepo, safeShutdown } = require(join(dist, "repo.js"))
const { readConfig, storageDir } = require(join(dist, "config.js"))

type Link = { name: string; type: string; url: string }
type Folder = { title?: string; docs: Link[] }
type Repo = { find(url: string): Promise<{ doc(): unknown }> }

/** Runs `fn` with the checkout's repo open offline, and shuts it down after. */
export async function withCheckout<T>(
  root: string,
  fn: (repo: Repo, config: PushworkConfig) => Promise<T>,
): Promise<T> {
  const config: PushworkConfig = await readConfig(root)
  const repo: Repo = await openRepo(config.backend, storageDir(root), { offline: true })
  try {
    return await fn(repo, config)
  } finally {
    await safeShutdown(repo)
  }
}

/** Every package under `rootUrl`: posix path → headless url. A package is a folder holding a manifest.json. */
export async function packagesOf(repo: Repo, rootUrl: string): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  await walk(rootUrl, "")
  return found

  async function walk(url: string, path: string) {
    const folder = await folderAt(repo, url)
    if (!folder) return
    if (folder.docs.some((link) => link.name === "manifest.json")) {
      found.set(path, headless(url))
      return
    }
    for (const link of folder.docs) {
      if (link.type === "folder") await walk(link.url, path ? `${path}/${link.name}` : link.name)
    }
  }
}

/** The headless url of the folder or package at `path` under `rootUrl`; undefined if a step is missing. */
export async function urlAt(repo: Repo, rootUrl: string, path: string): Promise<string | undefined> {
  let url = rootUrl
  for (const name of path.split("/").filter(Boolean)) {
    const folder = await folderAt(repo, url)
    const link = folder?.docs.find((l) => l.name === name)
    if (!link) return undefined
    url = link.url
  }
  return headless(url)
}

/** The folder doc at `url`; undefined when the doc is not a folder. */
async function folderAt(repo: Repo, url: string): Promise<Folder | undefined> {
  const doc = (await repo.find(headless(url))).doc() as Partial<Folder> | undefined
  return Array.isArray(doc?.docs) ? (doc as Folder) : undefined
}

function headless(url: string): string {
  return url.split("#")[0]
}
