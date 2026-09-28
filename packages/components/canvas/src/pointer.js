/**
 * Keeps the pointers of `surface` in step with DOM events on the view's own
 * `dom`. Follows it: when another element becomes the view's, the listeners
 * move to it. Does nothing until the surface is there.
 */
export default function pointer(env) {
  const surface = env.get("surface")
  const down = new Set()
  let dom

  const write = (e) => {
    if (!surface.value) return
    surface.change((s) => {
      s.pointers[e.pointerId] = local(dom, e)
    })
  }
  const remove = (e) => {
    if (!surface.value) return
    surface.change((s) => {
      delete s.pointers[e.pointerId]
    })
  }

  const onDown = (e) => {
    down.add(e.pointerId)
    write(e)
  }
  const onMove = (e) => {
    if (dom && (down.has(e.pointerId) || dom.contains(e.target))) write(e)
  }
  const onUp = (e) => {
    if (!down.has(e.pointerId)) return
    down.delete(e.pointerId)
    write(e)
  }
  const onLeave = (e) => {
    if (!down.has(e.pointerId)) remove(e)
  }

  const detachDom = () => {
    dom?.removeEventListener("pointerdown", onDown)
    dom?.removeEventListener("pointerleave", onLeave)
  }
  const stop = env.own("dom").subscribe((next) => {
    if (!(next instanceof Element) || next === dom) return
    detachDom()
    dom = next
    dom.addEventListener("pointerdown", onDown)
    dom.addEventListener("pointerleave", onLeave)
  })
  window.addEventListener("pointermove", onMove)
  window.addEventListener("pointerup", onUp)
  window.addEventListener("pointercancel", onUp)
  return () => {
    stop()
    detachDom()
    window.removeEventListener("pointermove", onMove)
    window.removeEventListener("pointerup", onUp)
    window.removeEventListener("pointercancel", onUp)
  }
}

/** The pointer's position relative to `dom`, and which buttons are held. */
function local(dom, e) {
  const r = dom.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top, buttons: e.buttons }
}
