import { onCleanup } from "solid-js"
import type { Behavior, Doc, Environment, Handle } from "@/core/types"

/** Which behaviors a document of each type gets. Put at `components` on the root. */
export type Components = { [type: string]: Behavior[] }

/**
 * Shows a document: forks the environment, puts the document's handle at
 * `data` and a fresh element at `dom`, and attaches the behaviors for the
 * document's type. Destroys the fork when Solid disposes the component.
 */
export function View(props: { env: Environment; data: Handle<Doc> }) {
  const type = props.data.value["@patchwork"].type
  const behaviors = props.env.get<Components>("components").value[type] ?? []
  const dom = document.createElement("div")
  dom.className = type

  const env = props.env.fork()
  env.put("data", props.data)
  env.put("dom", dom)
  for (const behavior of behaviors) env.attach(behavior)

  onCleanup(() => env.destroy())
  return dom
}
