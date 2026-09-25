import type { Behavior, Directory, File, Load, Repo, Url } from "./types"

/** Loads packages from the repo by importing their entry point. Each url is imported once. */
export function createLoader(repo: Repo): Load {
  const loaded = new Map<Url, Promise<Behavior>>()
  return (url) => {
    let behavior = loaded.get(url)
    if (!behavior) loaded.set(url, (behavior = load(repo, url)))
    return behavior
  }
}

/**
 * Imports the entry point named by the package's `package.json` (`exports["."]`
 * or `main`); its default export is the behavior. The entry point must be a
 * self-contained module, since it is imported from a blob url.
 */
async function load(repo: Repo, url: Url): Promise<Behavior> {
  const dir = (await repo.find<Directory>(url)).value
  const manifest = JSON.parse(await text(repo, dir, "package.json"))
  const entry = String(manifest.exports?.["."] ?? manifest.main).replace(/^\.\//, "")
  const source = await text(repo, dir, entry)
  const blob = URL.createObjectURL(new Blob([source], { type: "text/javascript" }))
  try {
    const module = await import(/* @vite-ignore */ blob)
    if (typeof module.default !== "function") throw new Error(`${entry} of ${url} does not export a behavior`)
    return module.default
  } finally {
    URL.revokeObjectURL(blob)
  }
}

async function text(repo: Repo, dir: Directory, path: string): Promise<string> {
  const url = dir[path]
  if (typeof url !== "string") throw new Error(`no "${path}" in ${dir["@patchwork"].title ?? "package"}`)
  return (await repo.find<File>(url as Url)).value.content
}
