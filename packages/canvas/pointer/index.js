// Pointer input on the canvas: `surface/pointers`, pointer id → position in
// canvas coordinates and buttons. Mutated in place, so subscribers hear every
// move without readers of the slot being rerun.

export default function pointer(env) {
  if (env.get("data/@patchwork/type").value !== "canvas") return
  const dom = env.get("dom").value
  if (!(dom instanceof HTMLElement)) return
  const pointers = env.put("surface/pointers", {})

  const update = (event) => {
    const box = dom.getBoundingClientRect()
    pointers.change((all) => {
      all[event.pointerId] = {
        x: event.clientX - box.left,
        y: event.clientY - box.top,
        buttons: event.buttons,
        type: event.pointerType,
      }
    })
  }
  const remove = (event) => {
    pointers.change((all) => {
      delete all[event.pointerId]
    })
  }
  const listeners = {
    pointerdown: (event) => {
      dom.setPointerCapture?.(event.pointerId)
      update(event)
    },
    pointermove: update,
    pointerup: (event) => {
      update(event)
      if (event.pointerType !== "mouse") remove(event)
    },
    pointercancel: remove,
    pointerleave: (event) => {
      if (!event.buttons) remove(event)
    },
  }
  for (const [type, fn] of Object.entries(listeners)) dom.addEventListener(type, fn)
  return () => {
    for (const [type, fn] of Object.entries(listeners)) dom.removeEventListener(type, fn)
  }
}
