import { For } from "solid-js"
import { render } from "solid-js/web"
import type { Environment } from "@/core/types"
import { field } from "@/core/handle"
import { View } from "@/frameworks/solid/View"
import { useHandle } from "@/frameworks/solid/useHandle"
import type { Canvas, Shape } from "@/behaviors/types"

/**
 * Shows every entry of `data.shapes` in `dom`. The canvas places each shape
 * at its `x, y`; the shape's own behaviors draw it from there.
 */
export default function renderShapes(env: Environment) {
  const dom = env.get<HTMLElement>("dom").value
  const data = env.get<Canvas>("data")

  return render(() => {
    const canvas = useHandle(data)
    return (
      <For each={Object.keys(canvas().shapes)}>
        {(id) => {
          const shape = field<Shape>(data, "shapes", id)
          const s = useHandle(shape)
          return (
            <div class="shape" style={{ transform: `translate(${s().x}px, ${s().y}px)` }}>
              <View env={env} data={shape} />
            </div>
          )
        }}
      </For>
    )
  }, dom)
}
