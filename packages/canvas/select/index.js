// The select tool's behavior, on the select tool's shape: takes `tool` when no
// tool is active, selects what is pressed, and drags the selection along.

import { assign } from "../../lib/handle.js"

export default function select(env) {
  if (env.get("data/@patchwork/type").value !== "tool") return
  if (env.get("data/tool").value !== "select") return
  const pointers = env.get("surface/pointers")
  if (pointers.value === undefined) return
  const id = env.get("data/id").value
  const tool = env.get("tool")
  const hovering = env.get("surface/hovering")
  const shapes = env.get("surface/shapes")
  const selection = env.get("selection")

  const buttons = new Map() // pointer id → buttons last seen
  const drags = new Map() // pointer id → { from, starts: shape id → position at press }

  // The default tool: claims `tool` whenever it goes empty.
  const stopClaiming = tool.subscribe(() => {
    queueMicrotask(() => {
      if (tool.value === null) tool.change(() => id)
    })
  })
  const stopPointing = pointers.subscribe((all) => {
    for (const [pid, p] of Object.entries(all)) {
      const was = buttons.get(pid) ?? 0
      if (p.buttons && !was) press(pid, p)
      else if (p.buttons && drags.has(pid)) drag(pid, p)
      else if (!p.buttons) drags.delete(pid)
      buttons.set(pid, p.buttons)
    }
    for (const pid of [...buttons.keys()]) {
      if (pid in all) continue
      buttons.delete(pid)
      drags.delete(pid)
    }
  })
  return () => {
    stopClaiming()
    stopPointing()
  }

  function press(pid, p) {
    if (tool.value !== id) return
    const over = hovering.value?.[pid]?.shape
    const all = shapes.value ?? {}
    if (over === undefined) {
      assign(selection, {})
      return
    }
    if (all[over]?.locked) return
    if (!selection.value?.[over]) assign(selection, { [over]: true })
    const starts = {}
    for (const sid of Object.keys(selection.value ?? {})) {
      const shape = all[sid]
      if (shape && !shape.locked) starts[sid] = { x: shape.x, y: shape.y }
    }
    drags.set(pid, { from: { x: p.x, y: p.y }, starts })
  }

  function drag(pid, p) {
    const { from, starts } = drags.get(pid)
    const dx = p.x - from.x
    const dy = p.y - from.y
    shapes.change((all) => {
      for (const [sid, start] of Object.entries(starts)) {
        const shape = all[sid]
        if (!shape) continue
        shape.x = start.x + dx
        shape.y = start.y + dy
      }
    })
  }
}
