// Shape types and geometry shared by the canvas behaviors.
// Behaviors hit-test against the data in `shapes`; there is no scene graph.

import type { Attachment, Id, Json } from "./runtime"

export type Pointer = { x: number; y: number; buttons: number }
export type Point = [number, number]
export type Box = { x: number; y: number; w: number; h: number }

export type Stroke = { behaviors: { [id: Id]: Attachment }; points: Point[]; color: string }
export type Rect = { behaviors: { [id: Id]: Attachment }; x: number; y: number; w: number; h: number; color: string }
export type Shape = Stroke | Rect
export type Shapes = { [id: Id]: Shape }

export const HANDLE = 8 // handle size in px
export const STROKE_HIT = 6 // how close to a stroke counts as a hit

export function isRect(shape: Shape): shape is Rect {
  return "x" in shape
}

export function bounds(shape: Shape): Box {
  if (isRect(shape)) return { x: shape.x, y: shape.y, w: shape.w, h: shape.h }
  const xs = shape.points.map((p) => p[0])
  const ys = shape.points.map((p) => p[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

export function insideBox(b: Box, p: { x: number; y: number }, pad = 0): boolean {
  return p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad
}

function distanceToSegment(p: { x: number; y: number }, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / len2))
  const x = a[0] + t * dx, y = a[1] + t * dy
  return Math.hypot(p.x - x, p.y - y)
}

/** Is the point on the shape's body? */
export function hitShape(shape: Shape, p: { x: number; y: number }): boolean {
  if (isRect(shape)) return insideBox(bounds(shape), p)
  const pts = shape.points
  if (pts.length === 1) return Math.hypot(p.x - pts[0][0], p.y - pts[0][1]) <= STROKE_HIT
  for (let i = 1; i < pts.length; i++) if (distanceToSegment(p, pts[i - 1], pts[i]) <= STROKE_HIT) return true
  return false
}

/** The corners of a box, in the order nw, ne, se, sw. */
export function corners(b: Box): Point[] {
  return [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]]
}

/** Which resize handle of the shape is under the point, if any. */
export function hitHandle(shape: Shape, p: { x: number; y: number }): number | null {
  const i = corners(bounds(shape)).findIndex(([x, y]) => Math.abs(p.x - x) <= HANDLE && Math.abs(p.y - y) <= HANDLE)
  return i === -1 ? null : i
}

/** The topmost shape under the point. Later keys are on top. */
export function shapeAt(shapes: Shapes, p: { x: number; y: number }): Id | undefined {
  return Object.keys(shapes).reverse().find((id) => hitShape(shapes[id], p))
}

export function newId(): Id {
  return Math.random().toString(36).slice(2, 8)
}

export function json<T>(value: T): Json {
  return value as unknown as Json
}
