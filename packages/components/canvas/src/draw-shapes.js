import { For } from "solid-js"
import { render } from "solid-js/web"
import html from "solid-js/html"
import { field } from "/core"
import { View, useHandle } from "/frameworks/solid"

/**
 * Shows every entry of `data.shapes` in `dom`. The canvas places each shape
 * at its `x, y`; the shape's own behaviors draw it from there.
 */
export default function drawShapes(env) {
  const dom = env.get("dom").value
  const data = env.get("data")
  Object.assign(dom.style, {
    position: "relative",
    width: "640px",
    height: "480px",
    background: "white",
    border: "2px solid #4a8cf7",
    borderRadius: "4px",
    overflow: "hidden",
  })

  return render(() => {
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
}
