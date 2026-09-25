import type { Environment, Folder, Load, Repo, Url } from "./types"

/** Loads the package named `name` at the root of `packages` and attaches it to `env`. */
export async function attachPackage(env: Environment, name: string) {
  const repo = env.get<Repo>("repo").value
  const load = env.get<Load>("load").value
  const root = await folderAt(repo, env.get<Folder | Url>("packages").value, [])
  const entry = root?.docs.find((d) => d.name === name)
  if (!entry) throw new Error(`no "${name}" package`)
  env.attach(await load(entry.url))
}

/** The folder at `path` under `node`, following urls through the repo; undefined if a step is missing. */
export async function folderAt(repo: Repo, node: Folder | Url, path: string[]): Promise<Folder | undefined> {
  const folder = typeof node === "string" ? (await repo.find<Folder>(node)).value : node
  if (path.length === 0) return folder
  const entry = folder.docs.find((d) => d.name === path[0])
  if (!entry) return undefined
  return folderAt(repo, entry.url, path.slice(1))
}
