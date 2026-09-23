import { render } from "solid-js/web"
import type { Behavior, Environment } from "../runtime"
import { useHandle } from "../solid"

// On a rectangle's environment: draws it into `dom`.
export default {
  title: "Rect",
  description: `
Renders the declared values \`x\`, \`y\`, \`w\`, \`h\`, and \`color\` of a
rectangle as an outline in the shape's element. Attached by each
rectangle's own record.
`,
  mount(env: Environment) {
    const dom = env.get<HTMLElement>("dom").value
    const handles = {
      x: env.get<number>("x"), y: env.get<number>("y"),
      w: env.get<number>("w"), h: env.get<number>("h"),
      color: env.get<string>("color"),
    }

    return render(() => {
      const x = useHandle(handles.x), y = useHandle(handles.y)
      const w = useHandle(handles.w), h = useHandle(handles.h)
      const color = useHandle(handles.color)
      return (
        <svg class="shape-svg">
          <rect x={x()} y={y()} width={w()} height={h()} fill="none" stroke={color()} stroke-width="2" />
        </svg>
      )
    }, dom)
  },
} satisfies Behavior
