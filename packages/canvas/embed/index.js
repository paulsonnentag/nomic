// An embed shape shows another document at its position: `data.url`, found
// through the repo, in a view. The strip along its top belongs to the canvas,
// so pressing there selects and drags the shape; the body takes its own input.

import { render } from "solid-js/web"
import { View, isolate } from "../../lib/view.js"

const STRIP = 14 // px, the draggable strip along the top

export default function embed(env) {
  if (env.get("data/@patchwork/type").value !== "embed") return
  const url = env.get("data/url").value
  const repo = env.get("repo").value
  if (typeof url !== "string" || !repo) return

  const dom = document.createElement("div")
  dom.className = "embed"
  dom.style.cssText =
    "display:flex;flex-direction:column;border:1px solid #d4d4d8;border-radius:6px;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.08);overflow:hidden"
  const strip = document.createElement("div")
  strip.style.cssText = `height:${STRIP}px;flex:none;background:#f4f4f5;border-bottom:1px solid #e4e4e7`
  const body = isolate(document.createElement("div"))
  body.style.flex = "1"
  dom.append(strip, body)

  let dispose
  let cancelled = false
  repo
    .find(url)
    .then((data) => {
      if (cancelled) return
      dispose = render(() => View({ env, data }), body)
    })
    .catch((error) => console.error(`[embed] ${url}`, error))
  env.put("dom", dom)
  return () => {
    cancelled = true
    dispose?.()
  }
}
