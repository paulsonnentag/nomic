// What each pointer is over: `surface/hovering`, pointer id → the topmost
// shape under it and the id of the view showing that shape.

import { assign } from "../../lib/handle.js"
import { hits } from "../geometry.js"

export default function hover(env) {
  if (env.get("data/@patchwork/type").value !== "canvas") return
  const pointers = env.get("surface/pointers")
  if (pointers.value === undefined) return
  const shapes = env.get("surface/shapes")
  const hovering = env.put("surface/hovering", {})

  const update = () => {
    const all = shapes.value ?? {}
    const views = new Map() // shape id → view id
    for (const fork of env.forks) {
      const id = fork.get("data/id").value
      if (typeof id === "string") views.set(id, fork.id)
    }
    const next = {}
    for (const [id, p] of Object.entries(pointers.value ?? {})) {
      const shape = topmost(all, p.x, p.y)
      if (shape !== undefined) next[id] = { shape, env: views.get(shape) }
    }
    if (!same(hovering.value, next)) assign(hovering, next)
  }
  const stops = [pointers.subscribe(update), shapes.subscribe(update)]
  return () => stops.forEach((stop) => stop())
}

function topmost(all, x, y) {
  let best
  for (const [id, shape] of Object.entries(all)) {
    if (hits(shape, x, y) && (best === undefined || (shape.z ?? 0) >= (all[best].z ?? 0))) best = id
  }
  return best
}

function same(a, b) {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((k) => b[k] && a[k].shape === b[k].shape && a[k].env === b[k].env)
}
