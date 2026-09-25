import { headless } from "./urls.js"

/**
 * Mounts the package at `packageUrl` into the view `env`: attaches every provided behavior whose
 * supportedDataType is unset or equals the view's data type, in manifest order. Appends
 * { package, name } for each to `behaviors`. Returns a detach function.
 */
export async function mount(env, packageUrl) {
  const load = env.get("load").value
  const type = env.get("data").value["@patchwork"].type
  const snapshot = await load(packageUrl)
  const applicable = Object.entries(snapshot.manifest.provides ?? {}).filter(
    ([, b]) => !b.supportedDataType || b.supportedDataType === type,
  )
  // Every module arrives before any attaches: the manifest order holds and a view is never half mounted.
  const modules = await Promise.all(applicable.map(([, b]) => snapshot.import(b.module.replace(/^\.\//, ""))))
  const detach = modules.map((m) => env.attach(m.default))
  const behaviors = env.get("behaviors", [])
  behaviors.change((list) => {
    for (const [name] of applicable) list.push({ package: headless(packageUrl), name })
  })
  return () => detach.reverse().forEach((d) => d())
}
