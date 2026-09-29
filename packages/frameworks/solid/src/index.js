import { createSignal, onCleanup } from "solid-js"
import { render } from "solid-js/web"

/** A library: instantiated with a layer holding its imports. */
export default function solid(env) {
  /**
   * Shows a document: forks the environment and puts the document's handle at
   * `data`. The behaviors requested above the fork attach to it and decide for
   * themselves whether they apply. The view's element is whatever a behavior
   * puts at `dom` in the view itself (not an enclosing view's); it is shown
   * inside a stable wrapper and swapped when the visible `dom` changes (another
   * behavior's element chosen, or the behavior gone). Destroys the fork when
   * Solid disposes the component.
   */
  function View(props) {
    const wrapper = document.createElement("div")
    wrapper.className = `view ${props.data.value["@patchwork"].type}`
    const view = props.env.fork()
    view.put("data", props.data)
    const stop = view.own("dom").subscribe((dom) => {
      if (dom instanceof Node) wrapper.replaceChildren(dom)
    })
    onCleanup(() => {
      stop()
      view.destroy()
    })
    return wrapper
  }

  /** Renders a view of `data` into `element`; returns the dispose function. */
  function mountRoot(env, data, element) {
    return render(() => View({ env, data }), element)
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
