// Shows a line shape as a stroke through its points.

import { render } from "solid-js/web"
import html from "solid-js/html"
import { useHandle } from "../../lib/view.js"
import { pathOf } from "../../canvas/geometry.js"

export default function line(env) {
  if (env.get("data/@patchwork/type").value !== "line") return
  const data = env.get("data")
  const dom = document.createElement("div")
  dom.className = "line"
  const dispose = render(() => {
    const shape = useHandle(data)
    return html`<svg style="display:block;width:1px;height:1px;overflow:visible">
      <path
        d=${() => pathOf(shape()?.points ?? [])}
        fill="none"
        stroke=${() => shape()?.color ?? "#18181b"}
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>`
  }, dom)
  env.put("dom", dom)
  return dispose
}
