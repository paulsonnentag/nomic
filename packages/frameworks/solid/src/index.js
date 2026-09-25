import { createSignal, onCleanup } from "solid-js"
import { render } from "solid-js/web"

/** A library: instantiated with a layer holding its imports. */
export default function solid(env) {
  const { docAt, mount } = env.get("imports/core").value

  /**
   * Shows a document: forks the environment, puts the document's handle at
   * `data`, a fresh element at `dom` and an empty `behaviors` list, and mounts
   * the `loader` package, which decides what else the view gets. Destroys the
   * fork when Solid disposes the component.
   */
  function View(props) {
    const dom = document.createElement("div")
    dom.className = props.data.value["@patchwork"].type
    const view = props.env.fork()
    view.put("data", props.data)
    view.put("dom", dom)
    view.put("behaviors", [])
    mountLoader(view).catch(console.error)
    onCleanup(() => view.destroy())
    return dom
  }

  /** Renders a view of `data` into `element`; returns the dispose function. */
  function mountRoot(env, data, element) {
    return render(() => View({ env, data }), element)
  }

  async function mountLoader(view) {
    const repo = view.get("repo").value
    const url = await docAt(repo, view.get("packages").value, "loader")
    if (!url) throw new Error("no loader package")
    await mount(view, url)
  }

  return { View, useHandle, mountRoot }
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
