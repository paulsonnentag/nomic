// Delete or Backspace removes the selected shapes, locked ones excepted.

import { assign } from "../../lib/handle.js"

export default function remove(env) {
  if (env.get("data/@patchwork/type").value !== "canvas") return
  const selection = env.get("selection")
  if (selection.value === undefined) return
  const shapes = env.get("surface/shapes")

  const onKey = (event) => {
    if (event.key !== "Delete" && event.key !== "Backspace") return
    if (typing(event.target)) return
    const ids = Object.keys(selection.value ?? {})
    if (!ids.length) return
    event.preventDefault()
    shapes.change((all) => {
      for (const id of ids) if (all[id] && !all[id].locked) delete all[id]
    })
    assign(selection, {})
  }
  window.addEventListener("keydown", onKey)
  return () => window.removeEventListener("keydown", onKey)
}

function typing(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}
