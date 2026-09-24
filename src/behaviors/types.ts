// The documents and values the canvas behaviors share.

import type { Id } from "@/core/types"

export type Point = { x: number; y: number }

/** A line sits at `x, y` on the canvas; its points are relative to that. */
export type Line = { "@patchwork": { type: "line" }; x: number; y: number; points: Point[]; color: string }
export type Shape = Line
export type Canvas = { "@patchwork": { type: "canvas" }; shapes: { [id: Id]: Shape } }

/** The live state of the drawing surface: where each pointer is, relative to `dom`. */
export type Pointer = Point & { buttons: number }
export type Surface = { pointers: { [pointerId: string]: Pointer } }
