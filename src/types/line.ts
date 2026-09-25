import type { Meta } from "@/core/types"

export type Point = { x: number; y: number }

/** A line sits at `x, y` on the canvas; its points are relative to that. */
export type Line = { "@patchwork": Meta & { type: "line" }; x: number; y: number; points: Point[]; color: string }
