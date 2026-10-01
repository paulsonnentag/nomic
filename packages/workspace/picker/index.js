// The branch picker: a canvas shape showing the current branch, with the
// list to switch, a fork button and a merge button. Reads `branch` and
// `branches` from the workspace above.

import { For } from "solid-js"
import { render } from "solid-js/web"
import html from "solid-js/html"
import { useHandle, isolate } from "../../lib/view.js"

export default function picker(env) {
  if (env.get("data/@patchwork/type").value !== "branch-picker") return
  const branches = env.get("branches").value
  if (!branches) return
  const branch = env.get("branch")

  const dom = document.createElement("div")
  dom.className = "picker"
  dom.style.cssText =
    "display:flex;align-items:center;gap:6px;height:28px;padding:0 8px;border:1px solid #d4d4d8;border-radius:8px;background:#fff;font:12px system-ui;white-space:nowrap"
  isolate(dom)
  const dispose = render(() => Picker({ branch, branches }), dom)
  env.put("dom", dom)
  return dispose
}

function Picker(props) {
  const current = useHandle(props.branch)
  const onBranch = () => typeof current()?.from === "string"
  return html`
    <select style="font:inherit" onChange=${(event) => props.branches.switch(event.target.value)}>
      <${For} each=${() => props.branches.list}>
        ${(b) => html`<option value=${b.url} selected=${() => props.branch.url === b.url}>${b.name}</option>`}
      <//>
    </select>
    <button
      style="font:inherit"
      onClick=${() => {
        const name = prompt("Branch name", `${current()?.name ?? "branch"}-fork`)
        if (name) props.branches.fork(name)
      }}
    >
      fork
    </button>
    <button style="font:inherit" disabled=${() => !onBranch()} onClick=${() => props.branches.merge()}>merge</button>
  `
}
