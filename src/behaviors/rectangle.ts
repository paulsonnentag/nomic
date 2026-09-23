import type { Behavior, Environment, Id } from "../runtime"
import { json, newId, shapeAt, type Pointer, type Shapes } from "../shapes"

// While `tool` is "rectangle": a press on empty canvas starts a rect, moves size it.
export default {
  title: "Rectangle",
  description: `
While \`tool\` is \`"rectangle"\`, a press on empty canvas adds a rectangle
record to \`shapes\` at the pointer, and every move while the button is held
sizes it from the press point to the pointer. The record attaches the *Rect*
behavior, which draws it.
`,
  mount(env: Environment) {
    const pointer = env.get<Pointer>("pointer")
    const shapes = env.get<Shapes>("shapes")
    const tool = env.get<string>("tool")
    let drawing: { id: Id; x: number; y: number } | null = null
    let was = 0

    return pointer.subscribe((p) => {
      if (p.buttons && !was && tool.value === "rectangle" && !shapeAt(shapes.value, p)) {
        drawing = { id: newId(), x: p.x, y: p.y }
        const id = drawing.id
        shapes.change((s) => {
          s[id] = json({
            behaviors: { rect: { url: "behavior:rect", on: true } },
            x: p.x, y: p.y, w: 0, h: 0,
            color: "#0a7",
          }) as any
        })
      } else if (p.buttons && drawing) {
        const { id, x, y } = drawing
        shapes.change((s) => {
          const shape = s[id]
          if (!shape || !("x" in shape)) return
          shape.x = Math.min(x, p.x)
          shape.y = Math.min(y, p.y)
          shape.w = Math.abs(p.x - x)
          shape.h = Math.abs(p.y - y)
        })
      } else if (!p.buttons) {
        drawing = null
      }
      was = p.buttons
    })
  },
} satisfies Behavior
