/** Mounts every package under `components/`, in folder order, then the packages the document names. */
export default function loader(env) {
  const { entriesAt, mount } = env.get("imports/core").value
  const detach = []
  let cancelled = false
  run().catch(console.error)
  return () => {
    cancelled = true
    detach.reverse().forEach((d) => d())
  }

  async function run() {
    const repo = env.get("repo").value
    const root = env.get("packages").value
    const meta = env.get("data").value["@patchwork"]
    const components = await entriesAt(repo, root, "components")
    const urls = [...components.map((e) => e.url), ...(meta.behaviors ?? [])]
    for (const url of urls) {
      const d = await mount(env, url) // sequential: keeps cross-package order deterministic
      if (cancelled) return d()
      detach.push(d)
    }
  }
}
