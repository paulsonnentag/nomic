// The canvas: shows every shape in its own view at its position, draws the
// selection and highlights over them, and puts the slots the tools work on.

import { For } from "solid-js"
import { render } from "solid-js/web"
import html from "solid-js/html"
import { field } from "../../lib/handle.js"
import { View, svg, useHandle } from "../../lib/view.js"
import { pathOf } from "../geometry.js"

const SELECTION = "#2563eb"

export default function surface(env) {
  if (env.get("data/@patchwork/type").value !== "canvas") return
  const data = env.get("data")
  env.put("surface/shapes", field(data, "shapes"))
  env.put("tool", null)
  const selection = env.put("selection", {})
  const highlights = env.put("highlights", {})

  const dom = document.createElement("div")
  dom.className = "canvas"
  dom.style.cssText = "position:absolute;inset:0;overflow:hidden;background:#fafafa;touch-action:none;user-select:none"
  const dispose = render(() => Surface({ env, data, selection, highlights }), dom)
  env.put("dom", dom)
  return dispose
}

function Surface(props) {
  const canvas = useHandle(props.data)
  const selected = useHandle(props.selection)
  const marks = useHandle(props.highlights)
  const ids = () => Object.keys(canvas()?.shapes ?? {})
  const outline = (id) => {
    const shape = canvas()?.shapes?.[id]
    return shape?.outline?.length ? { x: shape.x, y: shape.y, points: shape.outline } : undefined
  }
  return html`
    <${For} each=${ids}>${(id) => Shape({ env: props.env, data: props.data, id })}<//>
    <svg style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1000;overflow:visible">
      <${For} each=${() => Object.keys(selected() ?? {})}>
        ${(id) => Trace({ outline: () => outline(id), color: () => SELECTION, dashed: () => false })}
      <//>
      <${For} each=${() => Object.keys(marks() ?? {})}>
        ${(key) =>
          Trace({
            outline: () => outline(marks()?.[key]?.shape),
            color: () => marks()?.[key]?.color ?? SELECTION,
            dashed: () => marks()?.[key]?.dashed ?? false,
          })}
      <//>
    </svg>
  `
}

/** One shape: a positioned box holding a view of the shape's data. Pointer events pass through to the surface unless the view takes them. */
function Shape(props) {
  const handle = field(props.data, "shapes", props.id)
  const shape = useHandle(handle)
  const style = () =>
    `position:absolute;left:0;top:0;pointer-events:none;z-index:${shape()?.z ?? 0};` +
    `transform:translate(${shape()?.x ?? 0}px,${shape()?.y ?? 0}px)`
  return html`<div data-shape=${props.id} style=${style}>${View({ env: props.env, data: handle })}</div>`
}

function Trace(props) {
  return svg("path", {
    fill: "none",
    "stroke-width": 1.5,
    stroke: props.color,
    "stroke-dasharray": () => (props.dashed() ? "4 3" : undefined),
    transform: () => (props.outline() ? `translate(${props.outline().x} ${props.outline().y})` : undefined),
    d: () => (props.outline() ? pathOf(props.outline().points) : undefined),
  })
}
