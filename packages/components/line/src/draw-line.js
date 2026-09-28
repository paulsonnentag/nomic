import { render } from "solid-js/web"
import html from "solid-js/html"

/** Puts at `dom` a drawing of `data.points` as a polyline from the origin; the canvas places it. */
export default function drawLine(env) {
  const { useHandle } = env.get("imports/solid").value
  const data = env.get("data")
  const dom = document.createElement("div")
  dom.className = "line"

  const dispose = render(() => {
    const line = useHandle(data)
    // The svg is a point that lets its content overflow.
    return html`<svg style="display:block;width:1px;height:1px;overflow:visible">
      <polyline
        points=${() =>
          line()
            .points.map((p) => `${p.x},${p.y}`)
            .join(" ")}
        fill="none"
        stroke=${() => line().color}
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>`
  }, dom)
  env.put("dom", dom)
  return dispose
}
