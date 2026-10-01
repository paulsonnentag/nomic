// The pen tool's behavior, on the pen tool's shape: while `tool` names it,
// each press starts a line shape and dragging extends it.

export default function pen(env) {
  if (env.get("data/@patchwork/type").value !== "tool") return
  if (env.get("data/tool").value !== "pen") return
  const pointers = env.get("surface/pointers")
  if (pointers.value === undefined) return
  const id = env.get("data/id").value
  const tool = env.get("tool")
  const shapes = env.get("surface/shapes")

  const buttons = new Map() // pointer id → buttons last seen
  const strokes = new Map() // pointer id → shape id being drawn

  return pointers.subscribe((all) => {
    for (const [pid, p] of Object.entries(all)) {
      const was = buttons.get(pid) ?? 0
      if (p.buttons && !was && tool.value === id) start(pid, p)
      else if (p.buttons && strokes.has(pid)) extend(pid, p)
      else if (!p.buttons) strokes.delete(pid)
      buttons.set(pid, p.buttons)
    }
    for (const pid of [...buttons.keys()]) {
      if (pid in all) continue
      buttons.delete(pid)
      strokes.delete(pid)
    }
  })

  function start(pid, p) {
    const sid = crypto.randomUUID()
    shapes.change((all) => {
      all[sid] = {
        "@patchwork": { type: "line" },
        id: sid,
        x: p.x,
        y: p.y,
        z: 0,
        points: [{ x: 0, y: 0 }],
        outline: [{ x: 0, y: 0 }],
      }
    })
    strokes.set(pid, sid)
  }

  function extend(pid, p) {
    const sid = strokes.get(pid)
    shapes.change((all) => {
      const shape = all[sid]
      if (!shape) return
      const x = p.x - shape.x
      const y = p.y - shape.y
      const last = shape.points[shape.points.length - 1]
      if (Math.hypot(x - last.x, y - last.y) < 2) return
      shape.points.push({ x, y })
      shape.outline.push({ x, y })
    })
  }
}
