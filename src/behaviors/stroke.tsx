import { render } from "solid-js/web"
import type { Behavior, Environment } from "../runtime"
import type { Point } from "../shapes"
import { useHandle } from "../solid"

// On a stroke's environment: draws its points into `dom`.
export default {
  title: "Stroke",
  description: `
Renders the declared values \`points\` and \`color\` of a stroke as a
polyline in the shape's element. Attached by each stroke's own record.
`,
  mount(env: Environment) {
    const dom = env.get<HTMLElement>("dom").value
    const points = env.get<Point[]>("points")
    const color = env.get<string>("color")

    return render(() => {
      const pts = useHandle(points)
      const c = useHandle(color)
      return (
        <svg class="shape-svg">
          <polyline
            points={pts().map((p) => p.join(",")).join(" ")}
            fill="none"
            stroke={c()}
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      )
    }, dom)
  },
} satisfies Behavior
