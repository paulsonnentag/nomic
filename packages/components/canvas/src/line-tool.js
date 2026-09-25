/**
 * A press on the canvas starts a line at the pointer; every move while the
 * button is held appends a point. Each pointer draws its own line, so
 * `drawing` maps pointer ids to the line they are extending. Waits for `surface`.
 */
export default function lineTool(env) {
  const data = env.get("data")
  const drawing = env.put("drawing", {})

  return env.get("surface").subscribe((s) => {
    for (const [pointerId, p] of Object.entries(s.pointers)) {
      const id = drawing.value[pointerId]
      if (p.buttons && !id) {
        const id = crypto.randomUUID()
        data.change((c) => {
          c.shapes[id] = start(p.x, p.y)
        })
        drawing.change((d) => {
          d[pointerId] = id
        })
      } else if (p.buttons && id) {
        data.change((c) => {
          const line = c.shapes[id]
          if (line) line.points.push({ x: p.x - line.x, y: p.y - line.y })
        })
      } else if (!p.buttons && id) {
        drawing.change((d) => {
          delete d[pointerId]
        })
      }
    }
  })
}

/** A new line document at `x, y`, with its first point at its own origin. */
function start(x, y) {
  return { "@patchwork": { type: "line" }, x, y, points: [{ x: 0, y: 0 }], color: "#0a7" }
}
