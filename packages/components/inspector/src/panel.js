import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { Portal, render } from "solid-js/web"
import html from "solid-js/html"

/**
 * Puts at `dom` the panel of an inspector document: the environment of the
 * view it targets — the bindings made there and who made them, the behaviors
 * attached and the package each came from, and the live values, from the root
 * down. Sections are selectable, so the behaviors of any environment in the
 * chain can be browsed; selecting a behavior shows the layer it sees the
 * environment through and its source. The document is
 * `{ target, environment, behavior, color }`: the inspected view's
 * environment, the selected environment in the chain (the target's when
 * unset), the `by` of the selected behavior, and the highlight color. The dock
 * (the `inspector` package) makes these documents and puts what a panel needs
 * from it at `inspector` on the root; without it the panel still shows, but
 * cannot select or close.
 */
export default function panel(env) {
  if (env.read("data/@patchwork/type") !== "inspector") return
  const { headless } = env.get("imports/core").value
  const { useHandle, View } = env.get("imports/solid").value
  const shared = env.get("imports/inspector").value
  const dock = env.get("inspector").value
  const data = env.get("data")
  // Package url (pinned or not) → its path in the checkout, when the dock knows it; live as the dock learns them.
  const names = (url) => dock?.names().get(headless(url))
  const dom = document.createElement("aside")
  dom.className = "nomic-inspector-panel"
  const dispose = render(
    () => Inspector({ env, root: shared.rootOf(env), data, dom, dock, names, useHandle, View, shared }),
    dom,
  )
  env.put("dom", dom)
  return dispose
}

function Inspector(props) {
  const { chain, Highlight, SelectButton, SHARED_CSS } = props.shared
  const state = props.useHandle(props.data)
  const self = props.data.value // the document itself, stable: how the dock knows this inspector
  const color = self.color
  const names = props.names
  const version = watchTree(props.root) // bumps when the tree of environments changes
  const change = (fn) => props.data.change(fn)
  const close = () => props.dock?.close(self)
  let bindings // the element of the bindings above the behaviors, whose height the split handle sets

  /** The inspected view's environment, while it exists. */
  const target = () => {
    version()
    const t = state().target
    return t && !t.destroyed ? t : undefined
  }
  /** The environment whose behaviors are shown: the selected section, or the target. */
  const environment = () => state().environment ?? target()
  const behaviors = () => (environment() ? (version(), environment().inspect().behaviors) : [])
  const behavior = () => behaviors().find((b) => b.by === state().behavior)
  /**
   * The chain from the root down to the target's environment, split at the
   * selected one: `above` ends with it, `below` is folded away under the
   * behaviors. The selected behavior's layer is shown as part of the selected
   * environment, in front of its own bindings. Each section above knows the
   * keys bound nearer to the selected environment, which override its own.
   */
  const sections = () => {
    if (!target()) return { above: [], below: [] }
    const list = chain(target()).reverse()
    const at = list.indexOf(environment())
    const above = list.slice(0, at < 0 ? list.length : at + 1).map((env) => ({ env, layer: undefined }))
    if (at >= 0) above[at].layer = behavior()?.layer
    const keys = above.map(({ env, layer }) => bindingsOf(env, layer).map((b) => b.key))
    for (const [i, s] of above.entries()) s.overridden = new Set(keys.slice(i + 1).flat())
    return { above, below: at < 0 ? [] : list.slice(at + 1) }
  }
  createEffect(() => {
    version()
    if (state().target?.destroyed) queueMicrotask(close) // the target is gone; closing disposes this render
  })
  const selectEnvironment = (env) =>
    change((s) => {
      s.environment = env
      s.behavior = undefined
    })
  const selectBehavior = (b) =>
    change((s) => {
      s.behavior = s.behavior === b.by ? undefined : b.by
    })
  const section = ({ env, layer, overridden }, folded = false) =>
    EnvSection({
      env,
      layer,
      overridden,
      folded,
      select: () => selectEnvironment(env),
      version,
      names,
      useHandle: props.useHandle,
      titleOf: props.shared.titleOf,
    })

  return html`
    <style>
      ${SHARED_CSS + CSS}
    </style>
    <div class="resize" onPointerDown=${(e) => resizePanel(e, props.dom)}></div>
    <header>
      <${Show} when=${props.dock}>
        ${() =>
          SelectButton({
            active: () => props.dock.selecting() === self,
            onClick: () => props.dock.toggle(self),
            color,
          })}
      <//>
      <span class="name">${() => (target() ? props.shared.titleOf(target()) : "inspector")}</span>
      <${Show} when=${props.dock}>
        <button class="nomic-inspector-button close" title="Close" onClick=${close}>×</button>
      <//>
    </header>
    <${Show} when=${target}>
      <div class="bindings" ref=${(el) => (bindings = el)}>
        <${For} each=${() => sections().above}>${(env) => section(env)}<//>
      </div>
      <div class="split" onPointerDown=${(e) => resizeSplit(e, bindings, props.dom)}></div>
      <div class="behaviors">
        ${() => BehaviorTree({ behaviors, selected: behavior, select: selectBehavior, names })}
        ${() => BehaviorDetail({ behavior, view: props.env, View: props.View })}
      </div>
      <${Show} when=${() => sections().below.length}>
        <div class="bindings folded">
          <${For} each=${() => sections().below}>${(env) => section({ env }, true)}<//>
        </div>
      <//>
    <//>
    <${Portal}>
      <${Show} when=${target}>${() => Highlight({ env: target, dashed: false, color })}<//>
    <//>
  `
}

const WIDTH = { min: 320, margin: 80 } // px: the narrowest panel, and the page kept visible left of it
const SPLIT = { min: 40, rest: 160 } // px: the shortest bindings area, and what the behaviors under it keep

/** Drags the left edge of `panel` from the pointer event `e`: the panel grows to the left, up to the viewport. */
function resizePanel(e, panel) {
  const box = panel.getBoundingClientRect()
  const max = box.width + box.left - WIDTH.margin
  drag(e, (dx) => {
    panel.style.width = `${clamp(box.width - dx, WIDTH.min, max)}px`
  })
}

/** Drags the edge between `bindings` and the behaviors under it in `panel`: the bindings take the height, the behaviors the rest. */
function resizeSplit(e, bindings, panel) {
  const start = bindings.getBoundingClientRect().height
  const max = panel.getBoundingClientRect().height - SPLIT.rest
  bindings.style.maxHeight = "none"
  drag(e, (_, dy) => {
    bindings.style.height = `${clamp(start + dy, SPLIT.min, max)}px`
  })
}

/** Follows the pointer of `e` until it is released, calling `move` with how far it has gone from where it started. */
function drag(e, move) {
  const handle = e.currentTarget
  const start = { x: e.clientX, y: e.clientY }
  const onMove = (ev) => move(ev.clientX - start.x, ev.clientY - start.y)
  const stop = () => {
    handle.removeEventListener("pointermove", onMove)
    handle.removeEventListener("pointerup", stop)
    handle.removeEventListener("pointercancel", stop)
  }
  handle.setPointerCapture(e.pointerId)
  handle.addEventListener("pointermove", onMove)
  handle.addEventListener("pointerup", stop)
  handle.addEventListener("pointercancel", stop)
  e.preventDefault()
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

/** A signal that changes whenever the structure of the tree under `root` does, at most once a frame. */
function watchTree(root) {
  const [version, setVersion] = createSignal(0)
  let frame
  const stop = root.watch(() => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      setVersion((v) => v + 1)
    })
  })
  onCleanup(() => {
    stop()
    cancelAnimationFrame(frame)
  })
  return version
}

// -- sections --

/**
 * One environment's own bindings, with those of `layer` — the selected
 * behavior's, which it sees in front of them — when given; its title selects
 * it. Bindings whose key is in `overridden` (bound nearer to the selected
 * environment) are grayed out. `folded` shows the title alone, for the
 * environments under the selected one.
 */
function EnvSection(props) {
  const info = createMemo(() => {
    props.version()
    return { bindings: bindingsOf(props.env, props.layer), behaviors: props.env.inspect().behaviors }
  })
  const overridden = (key) => props.overridden?.has(key) ?? false
  const nameOf = (by) => attributionName(info(), by, props.names)
  return html`<section class=${() => (props.folded ? "folded" : "")}>
    <h2 onClick=${props.select}>${() => props.titleOf(props.env)}</h2>
    <${Show} when=${() => !props.folded}>
      <${Show} when=${() => info().bindings.length} fallback=${html`<div class="dim">no bindings</div>`}>
        <table>
          <${For} each=${() => rows(info().bindings)}
            >${(row) =>
              row === REQUESTS
                ? RequestsRow({ info, nameOf })
                : BindingRow({ handle: row, info, nameOf, useHandle: props.useHandle, overridden })}<//
          >
        </table>
      <//>
    <//>
  </section>`
}

/**
 * The bindings of `env` and, in front of them, those of `layer` when given,
 * each tagged with the environment it is in; an own binding of a key the layer
 * also binds is marked `shadowed`.
 */
function bindingsOf(env, layer) {
  const front = layer ? layer.inspect().bindings.map((b) => ({ ...b, env: layer })) : []
  const keys = new Set(front.map((b) => b.key))
  const own = env.inspect().bindings.map((b) => ({ ...b, env, shadowed: keys.has(b.key) }))
  return [...front, ...own]
}

const REQUESTS = Symbol("behaviors") // the one row standing for every `behaviors/<url>` binding
const isRequest = (key) => key.startsWith("behaviors/")

/** The rows of a bindings table: a binding's handle each, except the requests, which share one row where the first of them was. */
function rows(bindings) {
  const out = []
  for (const b of bindings) {
    if (!isRequest(b.key)) out.push(b.handle)
    else if (!out.includes(REQUESTS)) out.push(REQUESTS)
  }
  return out
}

/**
 * What to show for the attribution `by`: the behavior's name when it is one
 * attached here; else it is a file — `<package pin>/<module>` — shown at its
 * path in the checkout when the dock knows the package (`bootstrap.js`,
 * `core/src/reconciler.js`); blank when there is none.
 */
function attributionName(info, by, names) {
  if (!by) return ""
  const behavior = info.behaviors.find((b) => b.by === by)
  if (behavior) return behavior.name
  const slash = by.indexOf("/")
  if (slash < 0) return by
  const path = names(by.slice(0, slash))
  if (path === undefined) return by
  const module = by.slice(slash + 1)
  return path ? `${path}/${module}` : module
}

/**
 * A binding: its key, the behavior that put it, and the value, live; the value
 * expands. When several behaviors put the key, the attribution is a picker of
 * which one's value shows. Grayed out when overridden: by a binding nearer to
 * the selected environment, or by the layer in front of this one. Keyed by the
 * visible handle, which lives as long as the binding does, so a row keeps its
 * state across changes to the rest of the environment.
 */
function BindingRow(props) {
  const binding = () => props.info().bindings.find((b) => b.handle === props.handle)
  const value = props.useHandle(props.handle)
  const by = () => binding()?.by
  const alternatives = () => binding()?.alternatives ?? []
  const choose = (e) => binding().env.choose(binding().key, alternatives()[e.currentTarget.selectedIndex].by)
  const overridden = () => binding()?.shadowed || props.overridden(binding()?.key)
  return html`<tr class=${() => (overridden() ? "overridden" : "")}>
    <td class="key">${() => binding()?.key}</td>
    <td class="by" title=${() => by() ?? ""}>
      <${Show} when=${() => alternatives().length > 1} fallback=${html`<span>${() => props.nameOf(by())}</span>`}>
        <select class="pick" title="Several behaviors put this; pick whose value shows" onChange=${choose}>
          <${For} each=${alternatives}
            >${(a) => html`<option selected=${() => a.by === by()}>${() => props.nameOf(a.by)}</option>`}<//
          >
        </select>
      <//>
    </td>
    ${ValueCell({ value, url: props.handle.url })}
  </tr>`
}

/**
 * The requests of an environment as one binding, `behaviors`: the package url
 * of each `behaviors/<url>` binding mapped to its value — the url while it
 * loads, then what the reconciler filled in ({ package, behaviors }) — and
 * attributed to every behavior that asked.
 */
function RequestsRow(props) {
  const requests = createMemo(() => props.info().bindings.filter((b) => isRequest(b.key)))
  const [tick, bump] = createSignal(0)
  createEffect(() => {
    const stops = requests().map((b) => b.handle.subscribe(() => bump((n) => n + 1)))
    onCleanup(() => stops.forEach((stop) => stop()))
  })
  const value = () => (
    tick(),
    Object.fromEntries(requests().map((b) => [b.key.slice("behaviors/".length), b.handle.value]))
  )
  const by = () => [...new Set(requests().map((b) => props.nameOf(b.by)))].join(", ")
  return html`<tr>
    <td class="key">behaviors</td>
    <td
      class="by"
      title=${() =>
        requests()
          .map((b) => b.by ?? "")
          .join("\n")}
    >
      <span>${by}</span>
    </td>
    ${ValueCell({ value, depth: 4 })}
  </tr>`
}

/** A value, one line, expanding to `depth` levels; with the document url under it when the handle has one. */
function ValueCell(props) {
  const [expanded, setExpanded] = createSignal(false)
  return html`<td>
    <details onToggle=${(e) => setExpanded(e.currentTarget.open)}>
      <summary><span class="value">${() => format(props.value(), 0)}</span></summary>
      <${Show} when=${expanded}><pre>${() => format(props.value(), props.depth ?? 3)}</pre><//>
    </details>
    <${Show} when=${typeof props.url === "string"}><div class="dim">${props.url}</div><//>
  </td>`
}

// -- behaviors --

/**
 * The active behaviors of the selected environment — the ones that did
 * something there — grouped by the package they came from; clicking one
 * selects it.
 */
function BehaviorTree(props) {
  const active = () => props.behaviors().filter((b) => b.active)
  return html`<div class="tree">
    <${Show} when=${() => active().length} fallback=${html`<div class="dim">no active behaviors</div>`}>
      <${For} each=${() => groups(active())}
        >${([, list]) =>
          html`<div class="group">
            <div class="pkg">${() => packageName(list[0].package, props.names)}</div>
            <${For} each=${list}
              >${(b) =>
                html`<button
                  class=${() => `behavior${props.selected()?.by === b.by ? " selected" : ""}`}
                  title=${b.by}
                  onClick=${() => props.select(b)}
                >
                  ${b.name}
                </button>`}<//
            >
          </div>`}<//
      >
    <//>
  </div>`
}

/**
 * The selected behavior, shown as a view of its behavior document: a fork of
 * this panel's view with the document at `data`, rendered by whatever
 * behaviors support the `behavior` type (the `components/behavior` package).
 */
function BehaviorDetail(props) {
  // The document handle is stable for as long as the behavior is attached, unlike the
  // inspect() records around it; keying on it keeps the view while the tree changes
  // (creating a view changes the tree, so anything else would loop).
  const handle = createMemo(() => props.behavior()?.handle)
  return html`<div class="detail">
    <${Show} when=${handle} fallback=${html`<div class="dim">select a behavior</div>`}>
      ${() => props.View({ env: props.view, data: handle() })}
    <//>
  </div>`
}

/** Behaviors grouped by the layer they came through, in order: [layer | undefined, behaviors][]. */
function groups(behaviors) {
  const out = new Map()
  for (const b of behaviors) out.set(b.layer, [...(out.get(b.layer) ?? []), b])
  return [...out]
}

/** The path of the package in the checkout when known, else its url. */
function packageName(url, names) {
  if (!url) return "attached directly"
  return names(url) ?? url
}

// -- formatting values --

const LIMIT = 20 // entries shown per object or array

/** `value` as text, `depth` levels deep; multi-line when it opens a container. */
function format(value, depth, indent = "") {
  const short = atom(value)
  if (short !== undefined) return short
  const inner = `${indent}  `
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]"
    if (depth <= 0) return `[…${value.length}]`
    const items = value.slice(0, LIMIT).map((v) => `${inner}${format(v, depth - 1, inner)}`)
    if (value.length > LIMIT) items.push(`${inner}… ${value.length - LIMIT} more`)
    return `[\n${items.join(",\n")}\n${indent}]`
  }
  const keys = Object.keys(value)
  if (keys.length === 0) return "{}"
  if (depth <= 0) return `{${keys.slice(0, 5).join(", ")}${keys.length > 5 ? ", …" : ""}}`
  const items = keys.slice(0, LIMIT).map((k) => `${inner}${k}: ${format(read(value, k), depth - 1, inner)}`)
  if (keys.length > LIMIT) items.push(`${inner}… ${keys.length - LIMIT} more`)
  return `{\n${items.join(",\n")}\n${indent}}`
}

/** The one-line text of a value that has no children to show; undefined for plain objects and arrays. */
function atom(value) {
  if (value === null) return "null"
  switch (typeof value) {
    case "undefined":
      return "undefined"
    case "string":
      return JSON.stringify(value.length > 60 ? `${value.slice(0, 57)}…` : value)
    case "number":
    case "boolean":
    case "bigint":
      return String(value)
    case "symbol":
      return value.toString()
    case "function":
      return `ƒ ${value.name || "anonymous"}`
  }
  if (value instanceof Element) {
    const classes = [...value.classList].map((c) => `.${c}`).join("")
    return `<${value.tagName.toLowerCase()}${classes}>`
  }
  if (value instanceof Node) return value.nodeName
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Map) return `Map(${value.size})`
  if (value instanceof Set) return `Set(${value.size})`
  if (ArrayBuffer.isView(value)) return `${value.constructor.name}(${value.length ?? value.byteLength})`
  return undefined
}

function read(object, key) {
  try {
    return object[key]
  } catch (error) {
    return `⚠ ${error instanceof Error ? error.message : String(error)}`
  }
}

const CSS = `
.nomic-inspector-panel { position: relative; width: 520px; flex: none; display: flex; flex-direction: column; background: #fff;
  border-left: 1px solid #ddd; box-shadow: -4px 0 16px rgba(0,0,0,.08);
  font: 12px/1.5 ui-monospace, Menlo, monospace; color: #222; text-align: left; }
.nomic-inspector-panel .resize { position: absolute; top: 0; bottom: 0; left: 0; width: 6px; cursor: col-resize; z-index: 1; }
.nomic-inspector-panel .split { position: relative; flex: none; height: 6px; margin: -3px 0; cursor: row-resize; z-index: 1; }
.nomic-inspector-panel header { display: flex; align-items: center; gap: 8px; padding: 6px 10px;
  border-bottom: 1px solid #eee; font-weight: bold; }
.nomic-inspector-panel header .name { flex: 1; }
.nomic-inspector-panel header .name .dim { font-weight: normal; }
.nomic-inspector-panel .bindings { flex: none; max-height: 50%; overflow: auto; border-bottom: 1px solid #ddd; }
.nomic-inspector-panel .bindings.folded { border-bottom: 0; border-top: 1px solid #ddd; }
.nomic-inspector-panel .bindings section { padding: 6px 10px; border-bottom: 1px solid #eee; }
.nomic-inspector-panel .bindings section:last-child { border-bottom: 0; }
.nomic-inspector-panel .bindings section.folded h2 { margin: 0; }
.nomic-inspector-panel .bindings h2 { margin: 0 0 4px; font-size: 13px; cursor: pointer; }
.nomic-inspector-panel .bindings h2:hover { background: #f6f6f6; }
.nomic-inspector-panel .bindings table { width: 100%; border-collapse: collapse; }
.nomic-inspector-panel .bindings td { padding: 1px 8px 1px 0; vertical-align: top; }
.nomic-inspector-panel .bindings td:last-child { padding-right: 0; width: 100%; }
.nomic-inspector-panel .bindings td.key { color: #0550ae; white-space: nowrap; }
.nomic-inspector-panel .bindings tr.overridden td { color: #bbb; }
.nomic-inspector-panel .by, .nomic-inspector-panel .dim { color: #999; }
.nomic-inspector-panel .bindings td.by { white-space: nowrap; }
.nomic-inspector-panel .bindings summary { cursor: pointer; }
.nomic-inspector-panel .bindings pre { margin: 2px 0 4px; padding: 4px; max-height: 300px; overflow: auto;
  white-space: pre-wrap; word-break: break-all; background: #f6f6f6; }
.nomic-inspector-panel .behaviors { display: flex; flex: 1; min-height: 0; }
.nomic-inspector-panel .tree { width: 180px; flex: none; padding: 6px 10px; overflow: auto; border-right: 1px solid #eee; }
.nomic-inspector-panel .group { margin: 2px 0 8px; }
.nomic-inspector-panel .pkg { color: #555; }
.nomic-inspector-panel .tree .behavior { display: block; width: 100%; padding: 1px 6px 1px 12px; border: 0;
  border-radius: 3px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.nomic-inspector-panel .tree .behavior:hover { background: #f2f2f2; }
.nomic-inspector-panel .tree .behavior.selected { color: #fff; background: #4a8cf7; }
.nomic-inspector-panel .detail { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 6px 10px; overflow: hidden; }
.nomic-inspector-panel .detail > .view { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.nomic-inspector-panel .detail > .view > * { flex: 1; min-height: 0; }
.nomic-inspector-panel td.by .pick { max-width: 140px; padding: 0 2px; border: 1px solid #ccc; border-radius: 3px;
  background: #fff; color: #4a8cf7; font: inherit; cursor: pointer; }
`
