import { onCleanup } from "solid-js"
import type { Doc, Environment, Handle } from "@/core/types"
import { attachPackage } from "@/core/packages"

/**
 * Shows a document: forks the environment, puts the document's handle at
 * `data` and a fresh element at `dom`, and attaches the `loader` package,
 * which decides what else the view gets. Destroys the fork when Solid
 * disposes the component.
 */
export function View<T extends Doc>(props: { env: Environment; data: Handle<T> }) {
  const dom = document.createElement("div")
  dom.className = props.data.value["@patchwork"].type

  const env = props.env.fork()
  env.put("data", props.data)
  env.put("dom", dom)
  attachPackage(env, "loader").catch(console.error)

  onCleanup(() => env.destroy())
  return dom
}
