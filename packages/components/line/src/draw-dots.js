import { render } from "solid-js/web"
import html from "solid-js/html"

/**
 * Puts at `dom` another drawing of `data.points`: a dot per point, from the
 * origin. An alternative to `draw-line` for the same view, so both are
 * candidates at `dom` and the inspector can pick which one shows.
 */
export default function drawDots(env) {
  const { useHandle } = env.get("imports/solid").value
  const data = env.get("data")
  const dom = document.createElement("div")
  dom.className = "line dots"

  const dispose = render(() => {
    const line = useHandle(data)
    return html`<svg style="display:block;width:1px;height:1px;overflow:visible">
      <path d=${() => dots(line().points, 2.5)} fill=${() => line().color} />
    </svg>`
  }, dom)
  env.put("dom", dom)
  return dispose
}

/** One path drawing a filled circle of radius `r` at every point. */
function dots(points, r) {
  return points.map((p) => `M${p.x - r} ${p.y} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0`).join(" ")
}
