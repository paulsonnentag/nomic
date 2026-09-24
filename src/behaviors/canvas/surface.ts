import type { Environment } from "@/core/types"
import type { Pointer, Surface } from "@/behaviors/types"

/** Puts `surface` and keeps its pointers in step with DOM events on `dom`. */
export default function surface(env: Environment) {
  const dom = env.get<HTMLElement>("dom").value
  const surface = env.put<Surface>("surface", { pointers: {} })
  const down = new Set<number>()

  const write = (e: PointerEvent) => {
    surface.change((s) => {
      s.pointers[e.pointerId] = local(dom, e)
    })
  }
  const remove = (e: PointerEvent) => {
    surface.change((s) => {
      delete s.pointers[e.pointerId]
    })
  }

  const onDown = (e: PointerEvent) => {
    down.add(e.pointerId)
    write(e)
  }
  const onMove = (e: PointerEvent) => {
    if (down.has(e.pointerId) || dom.contains(e.target as Node)) write(e)
  }
  const onUp = (e: PointerEvent) => {
    if (!down.has(e.pointerId)) return
    down.delete(e.pointerId)
    write(e)
  }
  const onLeave = (e: PointerEvent) => {
    if (!down.has(e.pointerId)) remove(e)
  }

  dom.addEventListener("pointerdown", onDown)
  dom.addEventListener("pointerleave", onLeave)
  window.addEventListener("pointermove", onMove)
  window.addEventListener("pointerup", onUp)
  window.addEventListener("pointercancel", onUp)
  return () => {
    dom.removeEventListener("pointerdown", onDown)
    dom.removeEventListener("pointerleave", onLeave)
    window.removeEventListener("pointermove", onMove)
    window.removeEventListener("pointerup", onUp)
    window.removeEventListener("pointercancel", onUp)
  }
}

function local(dom: HTMLElement, e: PointerEvent): Pointer {
  const r = dom.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top, buttons: e.buttons }
}
