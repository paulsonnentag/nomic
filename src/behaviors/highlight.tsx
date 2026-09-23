import { render } from "solid-js/web"
import { For, Show } from "solid-js"
import type { Behavior, Environment, Id } from "../runtime"
import { bounds, corners, HANDLE, type Shapes } from "../shapes"
import { useHandle } from "../solid"

// Draws the selection box and the resize handles around the selected shape.
export default {
  title: "Highlight selection",
  description: `
Draws a dashed box and four corner handles around the shape that
\`selected\` names. It only reads; switching it off hides the selection
without changing what *Drag* and *Resize* act on.
`,
  mount(env: Environment) {
    const dom = env.get<HTMLElement>("dom").value
    const shapes = env.get<Shapes>("shapes")
    const selected = env.get<Id | null>("selected")
    const el = dom.appendChild(document.createElement("div"))
    el.className = "highlight"

    const dispose = render(() => {
      const all = useHandle(shapes)
      const id = useHandle(selected)
      const box = () => {
        const shape = id() ? all()[id()!] : undefined
        return shape ? bounds(shape) : undefined
      }
      return (
        <Show when={box()}>
          {(b) => (
            <svg class="highlight-svg">
              <rect x={b().x} y={b().y} width={b().w} height={b().h} />
              <For each={corners(b())}>
                {([x, y]) => <rect class="handle" x={x - HANDLE / 2} y={y - HANDLE / 2} width={HANDLE} height={HANDLE} />}
              </For>
            </svg>
          )}
        </Show>
      )
    }, el)

    return () => {
      dispose()
      el.remove()
    }
  },
} satisfies Behavior
