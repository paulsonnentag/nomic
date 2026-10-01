// The inspector: shows the target view's environment. The chain of scopes
// from the root down to the target, one selected; its bindings with their
// candidates, and its behaviors with what they read.

import { For, Show, createSignal, onCleanup } from "solid-js"
import { render } from "solid-js/web"
import html from "solid-js/html"
import { useHandle, isolate } from "../../lib/view.js"

export default function panel(env) {
  if (env.get("data/@patchwork/type").value !== "inspector") return
  const data = env.get("data")
  const dom = document.createElement("aside")
  dom.className = "inspector"
  dom.style.cssText =
    "display:flex;flex-direction:column;width:360px;height:400px;overflow:auto;font:12px ui-monospace,monospace;color:#18181b"
  isolate(dom)
  const style = document.createElement("style")
  style.textContent = CSS
  dom.append(style)
  const dispose = render(() => Panel({ env, root: rootOf(env), data }), dom)
  env.put("dom", dom)
  return dispose
}

function Panel(props) {
  const state = useHandle(props.data)
  const [version, bump] = createSignal(0)
  onCleanup(props.root.subscribe(() => bump((v) => v + 1)))

  const target = () => {
    version()
    const id = state()?.target?.env
    return typeof id === "string" ? props.env.lookup(id) : undefined
  }
  const chain = () => {
    const out = []
    for (let scope = target(); scope; scope = scope.parent) out.unshift(scope)
    return out
  }
  const depth = () => Math.min(state()?.environment ?? Infinity, Math.max(chain().length - 1, 0))
  const selected = () => chain()[depth()]
  const change = (fn) => props.data.change(fn)

  return html`
    <div class="chain" style=${() => `border-color:${state()?.color ?? "#d4d4d8"}`}>
      <${For} each=${chain}>
        ${(scope, i) =>
          html`<button
            class=${() => (i() === depth() ? "sel" : "")}
            onClick=${() =>
              change((s) => {
                s.environment = i()
                delete s.behavior
              })}
          >
            ${() => titleOf(scope)}
          </button>`}
      <//>
    </div>
    <${Show}
      when=${selected}
      keyed=${true}
      fallback=${html`<div class="dim">the target's view is not on the page</div>`}
    >
      ${(scope) => Section({ scope, state, change, version })}
    <//>
  `
}

function Section(props) {
  const entries = () => {
    props.version()
    return Object.entries(props.scope.entries())
  }
  const behaviors = () => {
    props.version()
    return [...props.scope.behaviors]
  }
  return html`
    <h3>bindings <span class="dim">${() => props.scope.id}</span></h3>
    <table>
      <${For} each=${entries}>
        ${([key, handle]) => Row({ scope: props.scope, key, handle, version: props.version })}
      <//>
    </table>
    <h3>behaviors</h3>
    <${For} each=${behaviors}>
      ${(behavior) =>
        html`<div class=${() => (props.version(), "behavior" + (behavior.teardown ? " active" : ""))}>
          <div
            class="head"
            onClick=${() =>
              props.change((s) => {
                if (s.behavior === behavior.url) delete s.behavior
                else s.behavior = behavior.url
              })}
          >
            <span class="dot"></span>
            <span class="url">${nameOf(behavior.url)}</span>
            ${() => (props.version(), behavior.error ? html`<span class="err">${behavior.error}</span>` : "")}
          </div>
          <${Show} when=${() => props.state()?.behavior === behavior.url}>
            <div class="reads">
              <${For} each=${() => (props.version(), Object.keys(behavior.reads))}>
                ${(key) =>
                  html`<div>
                    <span class="key">${key}</span>
                    <span class="value">${() => (props.version(), text(props.scope.get(key).value))}</span>
                  </div>`}
              <//>
            </div>
          <//>
        </div>`}
    <//>
  `
}

function Row(props) {
  const value = useHandle(props.handle)
  const conflicts = () => {
    props.version()
    return props.scope.conflicts(props.key)
  }
  return html`<tr>
    <td class="key">${props.key}</td>
    <td class="value">${() => text(value())}</td>
    <td class="by">
      <${For} each=${conflicts}>
        ${(c) =>
          html`<button
            class=${() => (c.chosen ? "chosen" : "")}
            title=${c.url ?? "put by the site"}
            onClick=${() => props.scope.choose(props.key, c.url)}
          >
            ${nameOf(c.url)}
          </button>`}
      <//>
    </td>
  </tr>`
}

/** The root scope above `env`. */
function rootOf(env) {
  let scope = env
  while (scope.parent) scope = scope.parent
  return scope
}

/** A scope's name in the chain: what its data is, or where it sits. */
function titleOf(scope) {
  const data = scope.entries().data?.value
  const type = data?.["@patchwork"]?.type
  if (type) return type
  return scope.parent ? scope.id.split("/").pop() : "root"
}

/** The path of a behavior's url: `/packages/pen/pen/index.js?v=…` → `pen/pen`. */
function nameOf(url) {
  if (url === undefined) return "site"
  return url.replace(/^\/packages\//, "").replace(/\/index\.js(\?.*)?$/, "")
}

function text(value) {
  if (value === undefined) return "undefined"
  if (value === null) return "null"
  if (value instanceof Node) return `<${value.nodeName.toLowerCase()}>`
  if (typeof value === "function") return "function"
  if (typeof value === "object") {
    if (Array.isArray(value)) return `[${value.length}]`
    const keys = Object.keys(value)
    return keys.length > 4 ? `{${keys.slice(0, 4).join(", ")}, …}` : `{${keys.join(", ")}}`
  }
  const s = String(value)
  return s.length > 40 ? s.slice(0, 40) + "…" : s
}

const CSS = `
  .inspector .chain { display:flex; flex-wrap:wrap; gap:4px; padding:6px; border-bottom:2px solid; }
  .inspector .chain button, .inspector .by button { font:inherit; padding:1px 6px; border:1px solid #d4d4d8; border-radius:4px; background:#fff; cursor:pointer; }
  .inspector .chain button.sel { background:#18181b; color:#fff; border-color:#18181b; }
  .inspector h3 { font:inherit; font-weight:600; margin:8px 8px 4px; }
  .inspector table { border-collapse:collapse; width:100%; }
  .inspector td { padding:2px 8px; vertical-align:top; border-top:1px solid #f4f4f5; }
  .inspector .key { color:#6b21a8; white-space:nowrap; }
  .inspector .value { color:#52525b; word-break:break-all; }
  .inspector .by { display:flex; flex-wrap:wrap; gap:2px; }
  .inspector .by button.chosen { border-color:#2563eb; background:#dbeafe; }
  .inspector .behavior .head { display:flex; gap:6px; align-items:center; padding:2px 8px; cursor:pointer; }
  .inspector .dot { width:7px; height:7px; border-radius:50%; background:#d4d4d8; flex:none; }
  .inspector .behavior.active .dot { background:#16a34a; }
  .inspector .err { color:#dc2626; }
  .inspector .reads { padding:2px 8px 6px 21px; color:#52525b; }
  .inspector .dim { color:#a1a1aa; padding:8px; }
`
