import type { Record } from "./runtime"

// The record the canvas starts from when storage is empty.
export const seed: Record = {
  behaviors: {
    pointer: { url: "behavior:pointer", on: true },
    canvas: { url: "behavior:canvas", on: true },
    toolbar: { url: "behavior:toolbar", on: true },
    pen: { url: "behavior:pen", on: true },
    rectangle: { url: "behavior:rectangle", on: true },
    select: { url: "behavior:select", on: true },
    highlight: { url: "behavior:highlight", on: true },
    drag: { url: "behavior:drag", on: true },
    resize: { url: "behavior:resize", on: true },
  },
  tool: "pen",
  selected: null,
  shapes: {
    s1: {
      behaviors: { stroke: { url: "behavior:stroke", on: true } },
      points: [[120, 90], [140, 160], [110, 210], [80, 220]],
      color: "#0a7",
    },
    s2: {
      behaviors: { rect: { url: "behavior:rect", on: true } },
      x: 260, y: 200, w: 110, h: 70,
      color: "#0a7",
    },
  },
}
