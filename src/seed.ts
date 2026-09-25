import type { Directory, Entry, File, Folder, Repo, Url } from "@/core/types"

/**
 * Puts every built package under packages/ into the repo as a pushwork
 * directory of file documents, and returns their urls by package name.
 */
export function seedPackages(repo: Repo): { [name: string]: Url } {
  const urls: { [name: string]: Url } = {}
  for (const [name, files] of Object.entries(builtPackages())) {
    const dir: Directory = { "@patchwork": { type: "directory", title: name } }
    for (const [path, content] of Object.entries(files)) dir[path] = repo.create(file(path, content)).url
    urls[name] = repo.create(dir).url
  }
  return urls
}

/** Creates a folder document whose entries are `docs`, in the order given. */
export function folder(repo: Repo, title: string, docs: { [name: string]: Url }): Url {
  const entries: Entry[] = Object.entries(docs).map(([name, url]) => ({ name, type: kind(url), url }))
  const url = repo.create<Folder>({ "@patchwork": { type: "folder" }, title, docs: entries }).url
  folders.add(url)
  return url
}

const folders = new Set<Url>()
const kind = (url: Url) => (folders.has(url) ? "folder" : "directory")

/** The files of each package, read at build time: `{ name: { path: content } }`. */
function builtPackages(): { [name: string]: { [path: string]: string } } {
  const raw = import.meta.glob("../packages/*/{package.json,dist/index.js}", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as { [path: string]: string }
  const out: { [name: string]: { [path: string]: string } } = {}
  for (const [key, content] of Object.entries(raw)) {
    const [, name, path] = key.match(/^\.\.\/packages\/([^/]+)\/(.+)$/)!
    ;(out[name] ??= {})[path] = content
  }
  return out
}

function file(path: string, content: string): File {
  const name = path.split("/").pop()!
  const extension = name.split(".").pop() ?? ""
  const mimeType = extension === "js" ? "text/javascript" : extension === "json" ? "application/json" : "text/plain"
  return { "@patchwork": { type: "file" }, name, extension, mimeType, content }
}
