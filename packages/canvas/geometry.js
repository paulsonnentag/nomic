// Shape geometry: outlines are polylines in shape-local coordinates, closed
// when the last point equals the first.

/** A closed rectangle outline from the origin. */
export function rect(width, height) {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
    { x: 0, y: 0 },
  ]
}

/** Whether the canvas point is over the shape: inside a closed outline, or within `slack` px of an open one. */
export function hits(shape, x, y, slack = 6) {
  const outline = shape.outline
  if (!outline?.length) return false
  const px = x - shape.x
  const py = y - shape.y
  if (isClosed(outline)) return inside(outline, px, py)
  for (let i = 1; i < outline.length; i++) {
    if (distanceToSegment(px, py, outline[i - 1], outline[i]) <= slack) return true
  }
  return false
}

/** The shape's box in canvas coordinates: `{ left, top, right, bottom }`. */
export function bounds(shape) {
  const points = shape.outline?.length ? shape.outline : [{ x: 0, y: 0 }]
  const xs = points.map((p) => shape.x + p.x)
  const ys = points.map((p) => shape.y + p.y)
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) }
}

/** Whether two boxes share any area. */
export function overlaps(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

export function isClosed(outline) {
  if (outline.length < 4) return false
  const first = outline[0]
  const last = outline[outline.length - 1]
  return first.x === last.x && first.y === last.y
}

/** The outline as an SVG path string. */
export function pathOf(outline) {
  return outline.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ")
}

function inside(polygon, x, y) {
  let odd = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) odd = !odd
  }
  return odd
}

function distanceToSegment(x, y, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length))
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy))
}
