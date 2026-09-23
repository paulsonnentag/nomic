import type { Behavior, Environment, Id } from "../runtime"
import { bounds, hitHandle, type Box, type Pointer, type Shapes } from "../shapes"

// Resizes the selected shape from one of its corner handles.
export default {
  title: "Resize",
  description: `
While the button is held after a press on a corner handle of the selected
shape, moves that corner to the pointer. A rectangle's \`x\`, \`y\`, \`w\`,
\`h\` change directly; a stroke's points are scaled into the new bounds.
`,
  mount(env: Environment) {
    const pointer = env.get<Pointer>("pointer")
    const shapes = env.get<Shapes>("shapes")
    const selected = env.get<Id | null>("selected")
    let press: { id: Id; corner: number; from: Box } | null = null
    let was = 0

    return pointer.subscribe((p) => {
      if (p.buttons && !was) {
        const id = selected.value
        const shape = id ? shapes.value[id] : undefined
        const corner = shape ? hitHandle(shape, p) : null
        press = shape && corner !== null ? { id: id!, corner, from: bounds(shape) } : null
      } else if (p.buttons && press) {
        const { id, corner, from } = press
        // The corner opposite the one being dragged stays fixed.
        const fixedX = corner === 0 || corner === 3 ? from.x + from.w : from.x
        const fixedY = corner === 0 || corner === 1 ? from.y + from.h : from.y
        const to: Box = {
          x: Math.min(fixedX, p.x), y: Math.min(fixedY, p.y),
          w: Math.abs(p.x - fixedX), h: Math.abs(p.y - fixedY),
        }
        shapes.change((s) => {
          const shape = s[id]
          if (!shape) return
          if ("x" in shape) {
            Object.assign(shape, to)
          } else {
            const sx = from.w ? to.w / from.w : 1, sy = from.h ? to.h / from.h : 1
            for (const pt of shape.points) {
              pt[0] = to.x + (pt[0] - from.x) * sx
              pt[1] = to.y + (pt[1] - from.y) * sy
            }
          }
        })
      } else if (!p.buttons) {
        press = null
      }
      was = p.buttons
    })
  },
} satisfies Behavior
