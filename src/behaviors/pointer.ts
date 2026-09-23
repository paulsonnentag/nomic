import type { Behavior, Environment } from "../runtime"

// The only behavior that listens to the DOM. Everything else reads `pointer`.
export default {
  title: "Pointer",
  description: `
Writes \`pointer\` from DOM events on \`dom\`: the position relative to the
canvas and which buttons are held. Every other behavior that responds to
the pointer subscribes to this value. Switch it off and nothing on the
canvas responds.
`,
  mount(env: Environment) {
    const dom = env.get<HTMLElement>("dom").value
    env.put("pointer", { x: 0, y: 0, buttons: 0 })

    const write = (e: PointerEvent) => {
      const r = dom.getBoundingClientRect()
      env.put("pointer", { x: e.clientX - r.left, y: e.clientY - r.top, buttons: e.buttons })
    }
    let down = false
    const onDown = (e: PointerEvent) => {
      down = true
      write(e)
    }
    const onMove = (e: PointerEvent) => {
      if (down || e.target === dom || dom.contains(e.target as Node)) write(e)
    }
    const onUp = (e: PointerEvent) => {
      if (!down) return
      down = false
      write(e)
    }
    dom.addEventListener("pointerdown", onDown)
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    return () => {
      dom.removeEventListener("pointerdown", onDown)
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
  },
} satisfies Behavior
