// The nomic pushwork shape: folders of packages. A folder is a "patchwork-folder"
// doc whose links point at subfolders and packages; a package (any directory with
// a manifest.json) is one "vfs" directory doc holding all of its files. pushwork
// imports this module by path (it is persisted in .pushwork/config.json), which
// is why it is plain JavaScript.

import { pinUrl, stripHeads } from "pushwork"

/** Path → headless doc url for every folder and package seen by the last encode/decode; "" is the root. */
export const recorded = new Map()

export default { encode, decode }

const META = "@patchwork"
const RESERVED = new Set([META, "lastSyncAt", "with"])

async function encode({ repo, tree, previousRoot, title }) {
  if (tree.kind !== "dir") throw new Error("nomic shape: root must be a dir")
  recorded.clear()
  const existing = previousRoot ? await repo.find(stripHeads(previousRoot.url)) : undefined
  const handle = await encodeFolder(repo, title ?? "packages", tree, existing, "")
  return handle.url
}

async function decode({ repo, root }) {
  const doc = root.doc()
  if (!isFolderDoc(doc)) throw new Error(`nomic shape: expected a folder doc at ${root.url}`)
  recorded.clear()
  return decodeFolder(repo, root, "")
}

// -- encoding --

/** Writes the folder for `dir` into `existing` (or a fresh doc) and returns its handle. */
async function encodeFolder(repo, name, dir, existing, path) {
  const previous = existing?.doc()?.docs ?? []
  const links = []
  for (const [childName, child] of [...dir.entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const childPath = path ? `${path}/${childName}` : childName
    if (child.kind === "file") {
      links.push({ name: childName, type: extensionOf(childName), url: child.url })
    } else if (isPackage(child)) {
      const reuse = await reusable(repo, previous, childName, "directory", isDirectoryDoc)
      const handle = await encodeDirectory(repo, childName, child, reuse, childPath)
      links.push({ name: childName, type: "directory", url: pinUrl(handle) })
    } else {
      const reuse = await reusable(repo, previous, childName, "folder", isFolderDoc)
      const handle = await encodeFolder(repo, childName, child, reuse, childPath)
      links.push({ name: childName, type: "folder", url: pinUrl(handle) })
    }
  }
  let handle = existing
  if (!handle) {
    handle = repo.create({ [META]: { type: "folder" }, title: name, docs: links })
  } else if (!sameLinks(previous, links)) {
    handle.change((d) => {
      if (!d[META]) d[META] = { type: "folder" }
      if (typeof d.title !== "string") d.title = name
      d.docs = links
    })
  }
  recorded.set(path, stripHeads(handle.url))
  return handle
}

/** Writes the package `dir` as one directory doc into `existing` (or a fresh doc) and returns its handle. */
async function encodeDirectory(repo, name, dir, existing, path) {
  const flat = new Map(walkLeaves(dir))
  let handle = existing
  if (!handle) {
    handle = repo.create({ [META]: { type: "directory", title: name } })
  }
  const doc = handle.doc()
  const stale = Object.keys(doc).filter((key) => !RESERVED.has(key) && !flat.has(key))
  const changed = [...flat].filter(([key, url]) => doc[key] !== url)
  const titled = doc[META]?.title === name
  if (!existing || stale.length || changed.length || !titled) {
    handle.change((d) => {
      if (!d[META]) d[META] = { type: "directory" }
      if (d[META].title !== name) d[META].title = name
      for (const key of stale) delete d[key]
      for (const [key, url] of changed) d[key] = url
    })
  }
  recorded.set(path, stripHeads(handle.url))
  return handle
}

/** The existing doc behind the link named `name`, if it has the expected `type` and shape. */
async function reusable(repo, links, name, type, isExpected) {
  const link = links.find((l) => l.name === name && l.type === type)
  if (!link) return undefined
  const handle = await repo.find(stripHeads(link.url))
  return isExpected(handle.doc()) ? handle : undefined
}

function sameLinks(a, b) {
  return a.length === b.length && a.every((l, i) => l.name === b[i].name && l.type === b[i].type && l.url === b[i].url)
}

// -- decoding --

async function decodeFolder(repo, handle, path) {
  recorded.set(path, stripHeads(handle.url))
  const tree = newDir()
  for (const link of handle.doc().docs ?? []) {
    if (!link?.name || typeof link.url !== "string") continue
    const childPath = path ? `${path}/${link.name}` : link.name
    if (link.type === "folder") {
      const sub = await repo.find(link.url)
      if (isFolderDoc(sub.doc())) tree.entries.set(link.name, await decodeFolder(repo, sub, childPath))
    } else if (link.type === "directory") {
      const sub = await repo.find(link.url)
      if (isDirectoryDoc(sub.doc())) tree.entries.set(link.name, decodeDirectory(sub, childPath))
    } else {
      tree.entries.set(link.name, { kind: "file", url: link.url })
    }
  }
  return tree
}

function decodeDirectory(handle, path) {
  recorded.set(path, stripHeads(handle.url))
  const tree = newDir()
  for (const [key, url] of Object.entries(handle.doc())) {
    if (RESERVED.has(key) || typeof url !== "string") continue
    const segments = key.split("/").filter(Boolean)
    if (segments.length) setFileAt(tree, segments, url)
  }
  return tree
}

// -- trees --

const newDir = () => ({ kind: "dir", entries: new Map() })

/** Whether a directory node is a package: it holds a manifest.json file. */
function isPackage(dir) {
  return dir.entries.get("manifest.json")?.kind === "file"
}

function* walkLeaves(node, prefix = []) {
  if (node.kind === "file") {
    yield [prefix.join("/"), node.url]
    return
  }
  for (const [name, child] of node.entries) yield* walkLeaves(child, [...prefix, name])
}

function setFileAt(root, segments, url) {
  let current = root
  for (const name of segments.slice(0, -1)) {
    let next = current.entries.get(name)
    if (next?.kind !== "dir") current.entries.set(name, (next = newDir()))
    current = next
  }
  current.entries.set(segments[segments.length - 1], { kind: "file", url })
}

function extensionOf(filename) {
  const dot = filename.lastIndexOf(".")
  return dot > 0 ? filename.slice(dot + 1) : "file"
}

function isFolderDoc(doc) {
  return doc?.[META]?.type === "folder"
}

function isDirectoryDoc(doc) {
  return doc?.[META]?.type === "directory"
}
