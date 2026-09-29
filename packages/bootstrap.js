// Served from the root folder doc. Runs before anything else is resolved, so it
// walks the root doc with the repo directly, pins `core`, imports it by served
// url, and hands off. Core is the only package imported statically; everything
// else is resolved through the environment. Everything it puts is attributed to
// this file at the heads it was served from, like a behavior's puts are to its
// file.

const HERE = decodeURIComponent(new URL(import.meta.url).pathname.split("/")[1]) // the root, pinned as served
const ROOT = HERE.split("#")[0]

export default function boot(element, repo) {
  run(element, repo).catch((error) => console.error("[bootstrap] boot failed", error))
}

async function run(element, repo) {
  const pin = await linkUrl(repo, ROOT, "core") // the link carries heads: core as the root has it
  const core = await import(`/${encodeURIComponent(pin)}/src/index.js`)

  const root = core.createEnvironment()
  const env = root.as(`${HERE}/bootstrap.js`)
  env.put("repo", repo)
  env.put("packages", ROOT)
  // Serves every request at `behaviors/<url>`, here and in every view, for the life of the page.
  core.reconciler(root.as(`${pin}/src/reconciler.js`))

  // Every package is asked for once, on the root: each behavior attaches everywhere and decides where it applies.
  for (const entry of await core.entriesAt(repo, ROOT, "components")) env.put(`behaviors/${entry.url}`, entry.url)
  const inspectorUrl = await core.docAt(repo, ROOT, "inspector") // the page-level tool; missing is fine
  if (inspectorUrl) env.put(`behaviors/${inspectorUrl}`, inspectorUrl)

  const solidUrl = await core.docAt(repo, ROOT, "frameworks/solid")
  if (!solidUrl) throw new Error("no frameworks/solid package")
  const solid = await core.resolve(env, `${solidUrl}/src/index.js`)
  const canvas = await canvasDoc(repo)
  solid.mountRoot(env, core.fromDoc(canvas), element)
}

/** The pinned url of the entry named `name` in the folder doc at `folderUrl`. */
async function linkUrl(repo, folderUrl, name) {
  const folder = (await repo.find(folderUrl)).doc()
  const link = folder.docs.find((d) => d.name === name)
  if (!link) throw new Error(`no "${name}" in ${folderUrl}`)
  return link.url
}

/** The canvas document named by the location hash, or a fresh one that the hash is set to. */
async function canvasDoc(repo) {
  const url = location.hash.slice(1)
  if (url) return repo.find(url)
  const handle = repo.create({ "@patchwork": { type: "canvas" }, shapes: {} })
  location.hash = handle.url
  return handle
}
