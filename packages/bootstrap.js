// Served from the root folder doc. Runs before any import map exists, so it walks the
// root doc with the repo directly, pins `core`, imports it by served url, and hands off.

const ROOT = decodeURIComponent(new URL(import.meta.url).pathname.split("/")[1]).split("#")[0]

export default function boot(element, repo) {
  run(element, repo).catch((error) => console.error("[bootstrap] boot failed", error))
}

async function run(element, repo) {
  const coreUrl = await linkUrl(repo, ROOT, "core")
  const coreHandle = await repo.find(coreUrl)
  const pin = coreHandle.view(coreHandle.heads()).url
  const core = await import(`/${encodeURIComponent(pin)}/src/index.js`)

  const env = core.createEnvironment()
  env.put("repo", repo)
  env.put("packages", ROOT)
  env.put("load", core.createLoader(repo))

  const solidUrl = await core.docAt(repo, ROOT, "frameworks/solid")
  if (!solidUrl) throw new Error("no frameworks/solid package")
  const solid = await (await env.get("load").value(solidUrl)).import("src/index.js")
  const canvas = await canvasDoc(repo)
  solid.mountRoot(env, core.fromDoc(canvas), element)
}

/** The headless url of the entry named `name` in the folder doc at `folderUrl`. */
async function linkUrl(repo, folderUrl, name) {
  const folder = (await repo.find(folderUrl)).doc()
  const link = folder.docs.find((d) => d.name === name)
  if (!link) throw new Error(`no "${name}" in ${folderUrl}`)
  return link.url.split("#")[0]
}

/** The canvas document named by the location hash, or a fresh one that the hash is set to. */
async function canvasDoc(repo) {
  const url = location.hash.slice(1)
  if (url) return repo.find(url)
  const handle = repo.create({ "@patchwork": { type: "canvas" }, shapes: {} })
  location.hash = handle.url
  return handle
}
