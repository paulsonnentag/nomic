import type { Behavior, Environment, Id } from "../runtime"
import { hitHandle, hitShape, type Pointer, type Shapes } from "../shapes"

// Moves the selected shape while the button is held.
export default {
  title: "Drag",
  description: `
While the button is held after a press on the body of the selected shape,
moves the shape by the pointer's movement: it changes \`x\` and \`y\` of a
rectangle, or every point of a stroke. A press on a resize handle is
*Resize*'s, not this behavior's.
`,
  mount(env: Environment) {
    const pointer = env.get<Pointer>("pointer")
    const shapes = env.get<Shapes>("shapes")
    const selected = env.get<Id | null>("selected")
    let press: Id | null = null
    let last: Pointer | null = null

    return pointer.subscribe((p) => {
      if (p.buttons && !last?.buttons) {
        // Select has run by now, so `selected` is the shape under the press.
        const id = selected.value
        const shape = id ? shapes.value[id] : undefined
        press = shape && hitShape(shape, p) && hitHandle(shape, p) === null ? id : null
      } else if (p.buttons && press && last) {
        const id = press
        const dx = p.x - last.x, dy = p.y - last.y
        shapes.change((s) => {
          const shape = s[id]
          if (!shape) return
          if ("x" in shape) {
            shape.x += dx
            shape.y += dy
          } else {
            for (const pt of shape.points) {
              pt[0] += dx
              pt[1] += dy
            }
          }
        })
      } else if (!p.buttons) {
        press = null
      }
      last = p
    })
  },
} satisfies Behavior
