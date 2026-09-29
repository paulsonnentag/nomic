// Tree walking over folder documents ({ docs: [{ name, type, url }] }). A node is a
// document url or an inline folder object, so an in-memory folder can stand in for a synced one.
// Links carry heads, so a walk from a pinned root names exact content all the way down.

/** The doc url at `path` under `root` (folder url or inline folder object), as the link has it; undefined if missing. */
export async function docAt(repo, root, path) {
  const node = await nodeAt(repo, root, segments(path))
  return typeof node === "string" ? node : undefined
}

/** The folder doc at `path` (follows urls; descends inline objects). */
export async function folderAt(repo, root, path) {
  const node = await nodeAt(repo, root, segments(path))
  return node === undefined ? undefined : resolve(repo, node)
}

/** The entries of the folder at `path`, in order: [{ name, type, url }]. */
export async function entriesAt(repo, root, path) {
  const folder = await folderAt(repo, root, path)
  return folder?.docs ?? []
}

/** The node (url or inline object) reached by walking `path` from `root`; undefined if a step is missing. */
async function nodeAt(repo, node, path) {
  for (const segment of path) {
    const folder = await resolve(repo, node)
    const entry = folder?.docs?.find((d) => d.name === segment)
    if (!entry) return undefined
    node = entry.url
  }
  return node
}

/** The document behind a node: found in the repo for a url (at its heads when pinned), the object itself otherwise. */
async function resolve(repo, node) {
  if (typeof node !== "string") return node
  const handle = await repo.find(node)
  return handle.doc()
}

function segments(path) {
  if (Array.isArray(path)) return path
  return path.split("/").filter(Boolean)
}
