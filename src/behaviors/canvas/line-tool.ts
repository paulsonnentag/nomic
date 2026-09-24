import type { Environment, Id } from "@/core/types"
import type { Canvas, Line, Surface } from "@/behaviors/types"

/**
 * A press on the canvas starts a line at the pointer; every move while the
 * button is held appends a point. Each pointer draws its own line, so
 * `drawing` maps pointer ids to the line they are extending.
 */
export default function lineTool(env: Environment) {
  const data = env.get<Canvas>("data")
  const surface = env.get<Surface>("surface")
  const drawing = env.put<{ [pointerId: string]: Id }>("drawing", {})

  return surface.subscribe((s) => {
    for (const [pointerId, p] of Object.entries(s.pointers)) {
      const id = drawing.value[pointerId]
      if (p.buttons && !id) {
        const id = newId()
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

function start(x: number, y: number): Line {
  return { "@patchwork": { type: "line" }, x, y, points: [{ x: 0, y: 0 }], color: "#0a7" }
}

function newId(): Id {
  return Math.random().toString(36).slice(2, 8)
}
