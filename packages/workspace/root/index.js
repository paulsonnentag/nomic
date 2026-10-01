// Shows the workspace's root document through the branching repo, once
// `workspace/repo` has put it: the view then lives on the current branch.

import { render } from "solid-js/web"
import { View } from "../../lib/view.js"

export default function workspaceRoot(env) {
  if (env.get("data/@patchwork/type").value !== "workspace") return
  const repo = env.get("repo").value
  if (!repo?.branching) return
  const url = env.get("data/root").value
  if (typeof url !== "string") return

  const dom = document.createElement("div")
  dom.className = "workspace"
  dom.style.cssText = "position:relative;width:100%;height:100%"
  let dispose
  let cancelled = false
  repo
    .find(url)
    .then((data) => {
      if (cancelled) return
      dispose = render(() => View({ env, data }), dom)
    })
    .catch((error) => console.error(`[workspace/root] ${url}`, error))
  env.put("dom", dom)
  return () => {
    cancelled = true
    dispose?.()
  }
}
