// A view: a fork of the environment showing one document. Whatever behavior
// puts `dom` there is what shows.

import { createRenderEffect, createSignal, onCleanup } from "solid-js"

/**
 * Solid component. Forks `env` under the data's url, puts `data` and a null
 * `dom` there, and shows whatever `dom` becomes. Destroys the fork on cleanup.
 */
export function View(props) {
  const { env, data } = props
  const view = env.fork(data.url ?? "document")
  view.put("data", data)
  view.put("dom", null)
  const element = document.createElement("div")
  element.className = "view"
  element.style.display = "contents"
  const stop = view.get("dom").subscribe((dom) => {
    if (dom instanceof Node) element.replaceChildren(dom)
    else element.replaceChildren()
  })
  onCleanup(() => {
    stop()
    view.destroy()
  })
  return element
}

/**
 * The handle's value as a Solid signal. Goes through `subscribe` only, so
 * reading it inside a behavior's run is not tracked by the environment.
 */
export function useHandle(handle) {
  const [value, setValue] = createSignal(undefined, { equals: false })
  const stop = handle.subscribe((next) => setValue(() => next))
  onCleanup(stop)
  return value
}

/**
 * An SVG element with reactive attributes: a function is re-evaluated when
 * what it reads changes. `html` templates parse through `innerHTML`, so an
 * `<svg>` child on its own comes out as HTML; this makes it in the right namespace.
 */
export function svg(tag, attrs = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag)
  const set = (name, value) => {
    if (value === undefined || value === null || value === false) element.removeAttribute(name)
    else element.setAttribute(name, String(value))
  }
  for (const [name, value] of Object.entries(attrs)) {
    if (typeof value === "function") createRenderEffect(() => set(name, value()))
    else set(name, value)
  }
  return element
}

/** Stops pointer events from reaching the canvas surface below, for shapes that are controls. */
export function isolate(element) {
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "wheel"]) {
    element.addEventListener(type, (event) => event.stopPropagation())
  }
  element.style.pointerEvents = "auto"
  return element
}
