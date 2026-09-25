import { folderAt } from "@/core/packages"

/**
 * Mounts a view: attaches the packages under `components/<type>` for the
 * document's type, then the ones the document names itself. Puts the urls
 * it mounted at `behaviors`.
 */
export default function loader(env) {
  const detach = []
  let cancelled = false

  mount().catch(console.error)
  return () => {
    cancelled = true
    for (const d of detach.reverse()) d()
  }

  async function mount() {
    const repo = env.get("repo").value
    const load = env.get("load").value
    const meta = env.get("data").value["@patchwork"]
    const own = await folderAt(repo, env.get("packages").value, ["components", meta.type])
    const urls = [...(own?.docs.map((d) => d.url) ?? []), ...(meta.behaviors ?? [])]
    const behaviors = await Promise.all(urls.map(load))
    if (cancelled) return
    env.put("behaviors", urls)
    for (const behavior of behaviors) detach.push(env.attach(behavior))
  }
}
