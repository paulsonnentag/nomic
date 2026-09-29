import { For } from "solid-js"
import { render } from "solid-js/web"
import html from "solid-js/html"

/**
 * The canvas: puts at `dom` a fixed-size box that clips its content and shows
 * every entry of `data.shapes` in it, each placed at its `x, y` — the shape's
 * own behaviors draw it from there — and puts `surface`, the live state of the
 * pointers on the box. For canvas documents.
 */
export default function canvas(env) {
  if (env.read("data/@patchwork/type") !== "canvas") return
  const { field } = env.get("imports/core").value
  const { View, useHandle } = env.get("imports/solid").value
  const data = env.get("data")
  const dom = document.createElement("div")
  dom.className = "canvas"
  Object.assign(dom.style, {
    position: "relative",
    width: "640px",
    height: "480px",
    background: "white",
    border: "2px solid #ccc",
    borderRadius: "4px",
    overflow: "hidden",
    touchAction: "none",
    userSelect: "none",
  })

  const dispose = render(() => {
    const canvas = useHandle(data)
    return html`<${For} each=${() => Object.keys(canvas().shapes)}
      >${(id) => {
        const shape = field(data, "shapes", id)
        const s = useHandle(shape)
        return html`<div
          style=${() => `position:absolute;left:0;top:0;pointer-events:none;transform:translate(${s().x}px,${s().y}px)`}
        >
          ${View({ env, data: shape })}
        </div>`
      }}<//
    >`
  }, dom)
  env.put("dom", dom)
  env.put("surface", { pointers: {} })
  return dispose
}
