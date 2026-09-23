import { render } from "solid-js/web"
import { For } from "solid-js"
import type { Behavior, Environment } from "../runtime"
import { useHandle } from "../solid"

const TOOLS = [
  { id: "pen", label: "Pen", icon: "M4 16 C 8 4, 12 20, 16 8" },
  { id: "rectangle", label: "Rectangle", icon: "M4 5 H 16 V 15 H 4 Z" },
]

// Renders the tool buttons into `dom` and changes `tool`.
export default {
  title: "Toolbar",
  description: `
Shows a button for each tool in the top-left corner of the canvas. Pressing
a button changes the declared value \`tool\`. *Pen* and *Rectangle* read
\`tool\` to decide whether a press on empty canvas is theirs.
`,
  mount(env: Environment) {
    const dom = env.get<HTMLElement>("dom").value
    const tool = env.get<string>("tool")
    const el = dom.appendChild(document.createElement("div"))
    el.className = "toolbar"
    // A press on the toolbar is not a press on the canvas.
    el.addEventListener("pointerdown", (e) => e.stopPropagation())

    const dispose = render(() => {
      const current = useHandle(tool)
      return (
        <For each={TOOLS}>
          {(t) => (
            <button
              class="tool"
              classList={{ active: current() === t.id }}
              title={t.label}
              onClick={() => tool.change(() => t.id)}
            >
              <svg viewBox="0 0 20 20" width="20" height="20">
                <path d={t.icon} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              </svg>
            </button>
          )}
        </For>
      )
    }, el)

    return () => {
      dispose()
      el.remove()
    }
  },
} satisfies Behavior
