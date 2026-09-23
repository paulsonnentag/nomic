import type { Behavior, Environment, Id } from "../runtime"
import { hitHandle, shapeAt, type Pointer, type Shapes } from "../shapes"

// A press picks the topmost shape under the pointer.
export default {
  title: "Select",
  description: `
On a press, hit-tests \`pointer\` against every shape in \`shapes\` and
changes the declared value \`selected\` to the topmost hit, or to \`null\`
on empty canvas. A press on a resize handle of the selected shape keeps the
selection. Switch this off and the selection stays where it was.
`,
  mount(env: Environment) {
    const pointer = env.get<Pointer>("pointer")
    const shapes = env.get<Shapes>("shapes")
    const selected = env.get<Id | null>("selected")
    let was = 0

    return pointer.subscribe((p) => {
      if (p.buttons && !was) {
        const current = selected.value
        const onHandle = current && shapes.value[current] && hitHandle(shapes.value[current], p) !== null
        if (!onHandle) {
          const hit = shapeAt(shapes.value, p) ?? null
          if (hit !== current) selected.change(() => hit)
        }
      }
      was = p.buttons
    })
  },
} satisfies Behavior
