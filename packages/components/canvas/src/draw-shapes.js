import { For } from "solid-js"
import { render } from "solid-js/web"
import html from "solid-js/html"

/**
 * Shows every entry of `data.shapes` in `dom`. The canvas places each shape
 * at its `x, y`; the shape's own behaviors draw it from there.
 */
export default function drawShapes(env) {
  const { field } = env.get("imports/core").value
  const { View, useHandle } = env.get("imports/solid").value
  const dom = env.get("dom").value
  const data = env.get("data")

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
