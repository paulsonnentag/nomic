import { createSignal, onCleanup } from "solid-js"
import { render } from "solid-js/web"
import { docAt, mount } from "/core"

/**
 * Shows a document: forks the environment, puts the document's handle at
 * `data` and a fresh element at `dom`, and mounts the `loader` package,
 * which decides what else the view gets. Destroys the fork when Solid
 * disposes the component.
 */
export function View(props) {
  const dom = document.createElement("div")
  dom.className = props.data.value["@patchwork"].type
  const env = props.env.fork()
  env.put("data", props.data)
  env.put("dom", dom)
  mountLoader(env).catch(console.error)
  onCleanup(() => env.destroy())
  return dom
}

/**
 * A signal that follows a handle. Values may be edited in place, so every
 * change counts as a new value.
 */
export function useHandle(handle) {
  const [value, setValue] = createSignal(handle.value, { equals: false })
  const stop = handle.subscribe((v) => setValue(() => v))
  onCleanup(stop)
  return value
}

/** Renders a view of `data` into `element`; returns the dispose function. */
export function mountRoot(env, data, element) {
  return render(() => View({ env, data }), element)
}

async function mountLoader(env) {
  const repo = env.get("repo").value
  const url = await docAt(repo, env.get("packages").value, "loader")
  if (!url) throw new Error("no loader package")
  await mount(env, url)
}
