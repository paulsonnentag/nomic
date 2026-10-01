// Shows a line shape as dots at its points. Competes with `pen/line` for the
// line view's `dom`: the later attached wins, the inspector can choose.

import { For } from "solid-js"
import { render } from "solid-js/web"
import html from "solid-js/html"
import { svg, useHandle } from "../../lib/view.js"

export default function dots(env) {
  if (env.get("data/@patchwork/type").value !== "line") return
  const data = env.get("data")
  const dom = document.createElement("div")
  dom.className = "dots"
  const dispose = render(() => {
    const shape = useHandle(data)
    return html`<svg style="display:block;width:1px;height:1px;overflow:visible">
      <${For} each=${() => shape()?.points ?? []}>
        ${(p) => svg("circle", { cx: p.x, cy: p.y, r: 2.5, fill: () => shape()?.color ?? "#18181b" })}
      <//>
    </svg>`
  }, dom)
  env.put("dom", dom)
  return dispose
}
