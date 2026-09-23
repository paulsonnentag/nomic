import type { Behavior, Environment, Id } from "../runtime"
import { json, newId, shapeAt, type Point, type Pointer, type Shapes } from "../shapes"

// While `tool` is "pen": a press on empty canvas starts a stroke, moves extend it.
export default {
  title: "Pen",
  description: `
While \`tool\` is \`"pen"\`, a press on empty canvas adds a stroke record to
\`shapes\` and every move while the button is held appends a point to it.
The stroke's record attaches the *Stroke* behavior, which draws it.
`,
  mount(env: Environment) {
    const pointer = env.get<Pointer>("pointer")
    const shapes = env.get<Shapes>("shapes")
    const tool = env.get<string>("tool")
    let drawing: Id | null = null
    let was = 0

    return pointer.subscribe((p) => {
      if (p.buttons && !was && tool.value === "pen" && !shapeAt(shapes.value, p)) {
        drawing = newId()
        const id = drawing
        shapes.change((s) => {
          s[id] = json({
            behaviors: { stroke: { url: "behavior:stroke", on: true } },
            points: [[p.x, p.y]] as Point[],
            color: "#0a7",
          }) as any
        })
      } else if (p.buttons && drawing) {
        const id = drawing
        shapes.change((s) => {
          const shape = s[id]
          if (shape && "points" in shape) shape.points.push([p.x, p.y])
        })
      } else if (!p.buttons) {
        drawing = null
      }
      was = p.buttons
    })
  },
} satisfies Behavior
