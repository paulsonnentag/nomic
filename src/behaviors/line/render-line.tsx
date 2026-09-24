import { render } from "solid-js/web"
import type { Environment } from "@/core/types"
import { useHandle } from "@/frameworks/solid/useHandle"
import type { Line } from "@/behaviors/types"

/** Draws `data.points` as a polyline into `dom`, from the origin; the canvas places it. */
export default function renderLine(env: Environment) {
  const dom = env.get<HTMLElement>("dom").value
  const data = env.get<Line>("data")

  return render(() => {
    const line = useHandle(data)
    return (
      <svg class="line-svg">
        <polyline
          points={line()
            .points.map((p) => `${p.x},${p.y}`)
            .join(" ")}
          fill="none"
          stroke={line().color}
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    )
  }, dom)
}
