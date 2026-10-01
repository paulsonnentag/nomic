// A tool button: a shape of type `tool`. Pressing it writes its own shape id to
// `tool`; it shows as active while `tool` names it. What the tool does is
// another behavior's business, keyed on `data.tool`.

import { render } from "solid-js/web"
import html from "solid-js/html"
import { useHandle, isolate } from "../lib/view.js"

export default function tool(env) {
  if (env.get("data/@patchwork/type").value !== "tool") return
  const data = env.get("data")
  const active = env.get("tool")

  const dom = isolate(document.createElement("div"))
  dom.className = "tool"
  dom.addEventListener("pointerdown", () => {
    const id = data.value?.id
    if (id) active.change(() => id)
  })
  const dispose = render(() => Button({ data, active }), dom)
  env.put("dom", dom)
  return dispose
}

function Button(props) {
  const shape = useHandle(props.data)
  const current = useHandle(props.active)
  const on = () => current() !== null && current() === shape()?.id
  return html`<button
    style=${() =>
      `width:40px;height:40px;border-radius:8px;border:1px solid ${on() ? "#2563eb" : "#d4d4d8"};` +
      `background:${on() ? "#dbeafe" : "#fff"};color:#18181b;font:11px system-ui;cursor:pointer;` +
      `display:flex;align-items:center;justify-content:center;padding:0`}
  >
    ${() => shape()?.label ?? shape()?.tool ?? "?"}
  </button>`
}
