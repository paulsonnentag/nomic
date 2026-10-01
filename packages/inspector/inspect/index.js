// The inspect tool's behavior, on the inspect tool's shape: while `tool` names
// it, the shape under the pointer is outlined; pressing one creates an
// inspector document targeting that shape's view and embeds it on the canvas.

import { bounds, overlaps, rect } from "../../canvas/geometry.js"

export const COLORS = ["#db2777", "#7c3aed", "#0891b2", "#ea580c", "#16a34a"]
const SIZE = { width: 360, height: 420 }
const GAP = 16 // px between the inspector and what it sits beside

export default function inspect(env) {
  if (env.get("data/@patchwork/type").value !== "tool") return
  if (env.get("data/tool").value !== "inspect") return
  const pointers = env.get("surface/pointers")
  if (pointers.value === undefined) return
  const id = env.get("data/id").value
  const tool = env.get("tool")
  const hovering = env.get("surface/hovering")
  const shapes = env.get("surface/shapes")
  const highlights = env.get("highlights")
  const repo = env.get("repo")

  const buttons = new Map() // pointer id → buttons last seen
  const stopPreviewing = pointers.subscribe(preview)
  const stopSwitching = tool.subscribe(() => preview(pointers.value ?? {}))
  const stopPressing = pointers.subscribe((all) => {
    for (const [pid, p] of Object.entries(all)) {
      if (p.buttons && !(buttons.get(pid) ?? 0)) press(pid, p)
      buttons.set(pid, p.buttons)
    }
    for (const pid of [...buttons.keys()]) if (!(pid in all)) buttons.delete(pid)
  })
  return () => {
    stopPreviewing()
    stopSwitching()
    stopPressing()
    highlights.change((marks) => {
      for (const key of Object.keys(marks)) if (key.startsWith("inspect/")) delete marks[key]
    })
  }

  /** Outlines what each pointer is over, dashed, while this is the tool. */
  function preview(all) {
    const color = COLORS[count() % COLORS.length]
    highlights.change((marks) => {
      for (const key of Object.keys(marks)) if (key.startsWith("inspect/")) delete marks[key]
      if (tool.value !== id) return
      for (const pid of Object.keys(all)) {
        const over = hovering.value?.[pid]
        if (over && !shapes.value?.[over.shape]?.locked)
          marks[`inspect/${pid}`] = { shape: over.shape, color, dashed: true }
      }
    })
  }

  function press(pid, p) {
    if (tool.value !== id) return
    const over = hovering.value?.[pid]
    if (!over || shapes.value?.[over.shape]?.locked) return
    const color = COLORS[count() % COLORS.length]
    const doc = repo.value.create({
      "@patchwork": { type: "inspector" },
      target: { shape: over.shape, env: over.env },
      color,
      picking: false,
    })
    const sid = crypto.randomUUID()
    const at = placeBeside(shapes.value ?? {}, over.shape)
    shapes.change((all) => {
      all[sid] = {
        "@patchwork": { type: "embed" },
        id: sid,
        url: doc.url,
        x: at.x,
        y: at.y,
        z: 1,
        outline: rect(SIZE.width, SIZE.height),
      }
    })
    tool.change(() => null) // hands over to the default tool; the preview clears with it
  }

  /**
   * Where a new inspector goes: right of the target, top-aligned with it, then
   * moved down past any embed it would overlap, so the target and the other
   * inspectors stay visible.
   */
  function placeBeside(all, target) {
    const box = bounds(all[target])
    const at = { x: box.right + GAP, y: box.top }
    const embeds = Object.values(all)
      .filter((s) => s["@patchwork"]?.type === "embed")
      .map(bounds)
    for (let moved = true; moved;) {
      moved = false
      const mine = { left: at.x, top: at.y, right: at.x + SIZE.width, bottom: at.y + SIZE.height }
      for (const other of embeds) {
        if (!overlaps(mine, other)) continue
        at.y = other.bottom + GAP
        moved = true
      }
    }
    return at
  }

  /** How many inspectors the canvas holds, to pick the next color. */
  function count() {
    return Object.values(shapes.value ?? {}).filter((s) => s["@patchwork"]?.type === "embed").length
  }
}
