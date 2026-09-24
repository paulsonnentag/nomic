import { render } from "solid-js/web"
import { createEnvironment } from "@/core/environment"
import { createHandle } from "@/core/handle"
import type { Doc } from "@/core/types"
import { View, type Components } from "@/frameworks/solid/View"
import surface from "@/behaviors/canvas/surface"
import lineTool from "@/behaviors/canvas/line-tool"
import renderShapes from "@/behaviors/canvas/render-shapes"
import renderLine from "@/behaviors/line/render-line"
import type { Canvas } from "@/behaviors/types"
import "./styles.css"

const components: Components = {
  canvas: [surface, lineTool, renderShapes],
  line: [renderLine],
}

const seed: Canvas = {
  "@patchwork": { type: "canvas" },
  shapes: {
    a: {
      "@patchwork": { type: "line" },
      x: 120,
      y: 90,
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 70 },
        { x: -10, y: 120 },
        { x: -40, y: 130 },
      ],
      color: "#0a7",
    },
  },
}

const root = createEnvironment()
root.put("components", components)
const data = createHandle<Doc>(seed)

render(() => <View env={root} data={data} />, document.getElementById("root")!)
