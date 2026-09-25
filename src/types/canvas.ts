import type { Id, Meta } from "@/core/types"

/** The canvas places a shape at its `x, y`; the shape's own behaviors draw the rest. */
export type Shape = { "@patchwork": Meta; x: number; y: number }
export type Canvas = { "@patchwork": Meta & { type: "canvas" }; shapes: { [id: Id]: Shape } }

/** The live state of the drawing surface: where each pointer is, relative to `dom`. */
export type Pointer = { x: number; y: number; buttons: number }
export type Surface = { pointers: { [pointerId: string]: Pointer } }
