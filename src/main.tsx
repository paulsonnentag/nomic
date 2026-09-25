import { render } from "solid-js/web"
import { createEnvironment } from "@/core/environment"
import { createRepo } from "@/core/repo"
import { createLoader } from "@/core/load"
import { View } from "@/frameworks/solid/View"
import { folder, seedPackages } from "@/seed"
import type { Canvas } from "@/types/canvas"
import type { Line } from "@/types/line"
import "./styles.css"

const repo = createRepo()
const pkg = seedPackages(repo)

// What a view can mount: the loader, and the components of each document type, in attach order.
const packages = folder(repo, "packages", {
  loader: pkg.loader,
  components: folder(repo, "components", {
    canvas: folder(repo, "canvas", {
      pointer: pkg.pointer,
      "line tool": pkg["line-tool"],
      "draw shapes": pkg["draw-shapes"],
    }),
    line: folder(repo, "line", { "draw line": pkg["draw-line"] }),
  }),
})

const line: Line = {
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
}

const seed: Canvas = {
  "@patchwork": { type: "canvas" },
  shapes: { a: line },
}

const root = createEnvironment()
root.put("repo", repo)
root.put("load", createLoader(repo))
root.put("packages", packages)
const data = repo.create<Canvas>(seed)

render(() => <View env={root} data={data} />, document.getElementById("root")!)
