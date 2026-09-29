import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { render } from "solid-js/web"
import html from "solid-js/html"

/**
 * Puts at `dom` a picture of what a behavior does, drawn from its document:
 * on the left what it took from the environment — the keys it `read` (tracked:
 * a change reruns it) and the ones it got untracked — in the middle the
 * behavior itself, on the right what it `put`, wired together. Read values are
 * what the run saw; gets and puts carry live handles, so those follow the
 * environment. An element put at `dom` is shown as a scaled copy. For behavior
 * documents.
 */
export default function showGraph(env) {
  if (env.read("data/@patchwork/type") !== "behavior") return
  const { useHandle } = env.get("imports/solid").value
  const data = env.get("data")
  const dom = document.createElement("div")
  dom.className = "behavior-graph"
  const dispose = render(() => Graph({ data, useHandle }), dom)
  env.put("dom", dom)
  return dispose
}

const CENTER = "behavior" // the id of the behavior's own node

function Graph(props) {
  const b = props.useHandle(props.data)
  /** The inputs: every read, then every get of a key not also read. */
  const inputs = () => {
    const reads = b().reads ?? []
    const gets = (b().gets ?? []).filter((g) => !reads.some((r) => r.key === g.key))
    return [...reads.map((r) => ({ ...r, kind: "read" })), ...gets.map((g) => ({ ...g, kind: "get" }))]
  }
  const outputs = () => (b().puts ?? []).map((p) => ({ ...p, kind: "put" }))
  const input = (key) => inputs().find((i) => i.key === key)
  const output = (key) => outputs().find((o) => o.key === key)

  // Wires are drawn from where the nodes are, re-measured when the document changes or a node resizes.
  const nodes = new Map() // id -> element
  const [tick, bump] = createSignal(0)
  const observer = new ResizeObserver(() => bump((n) => n + 1))
  onCleanup(() => observer.disconnect())
  let board
  const setBoard = (el) => {
    board = el
    observer.observe(el)
  }
  const register = (id) => (el) => {
    nodes.set(id, el)
    observer.observe(el)
  }
  createEffect(() => {
    b()
    requestAnimationFrame(() => bump((n) => n + 1))
  })
  const wires = () => {
    tick()
    const center = nodes.get(CENTER)
    if (!board || !center) return ""
    const origin = board.getBoundingClientRect()
    const c = center.getBoundingClientRect()
    const paths = []
    for (const i of inputs()) {
      const r = nodes.get(`in:${i.key}`)?.getBoundingClientRect()
      if (r?.width) paths.push(wire(r.right, mid(r), c.left, mid(c), origin, i.kind))
    }
    for (const o of outputs()) {
      const r = nodes.get(`out:${o.key}`)?.getBoundingClientRect()
      if (r?.width) paths.push(wire(c.right, mid(c), r.left, mid(r), origin, o.kind))
    }
    return paths.join("")
  }

  return html`
    <style>
      ${CSS}
    </style>
    <div class="board" ref=${setBoard}>
      <svg class="wires" innerHTML=${wires}></svg>
      <div class="column">
        <${Show} when=${() => inputs().length} fallback=${html`<div class="placeholder">reads nothing</div>`}>
          <${For} each=${() => inputs().map((i) => i.key)}
            >${(key) =>
              Node({
                ref: register(`in:${key}`),
                kind: () => input(key)?.kind,
                title: key,
                value: follow(() => input(key)),
              })}<//
          >
        <//>
      </div>
      <div class="column">
        <div class="node center" ref=${register(CENTER)}>
          <div class="name">${() => b().name}</div>
          <div class="dim">${() => b().module ?? "attached directly"}</div>
          <div>
            <span class=${() => (b().active ? "active" : "dim")}>${() => (b().active ? "active" : "inactive")}</span>
            <span class="dim">${() => ` · ran ${b().runs ?? 0}×`}</span>
          </div>
          <${Show} when=${() => b().error}><div class="error">⚠ ${() => b().error}</div><//>
        </div>
      </div>
      <div class="column">
        <${Show} when=${() => outputs().length} fallback=${html`<div class="placeholder">puts nothing</div>`}>
          <${For} each=${() => outputs().map((o) => o.key)}
            >${(key) =>
              Node({
                ref: register(`out:${key}`),
                kind: () => "put",
                title: key,
                value: follow(() => output(key)),
              })}<//
          >
        <//>
      </div>
    </div>
  `
}

/** A node: its key and its value, live; an element as a scaled copy. */
function Node(props) {
  return html`<div class=${() => `node ${props.kind() ?? ""}`} ref=${props.ref}>
    <div class="key">${props.title}</div>
    <${Show}
      when=${() => props.value() instanceof Element}
      fallback=${html`<pre class="value">${() => format(props.value(), 2)}</pre>`}
    >
      ${() => Preview({ element: props.value })}
    <//>
  </div>`
}

/**
 * A signal following an input or output entry: a read's value as seen, else
 * what its handle holds now. Resubscribes when the entry's handle changes,
 * as it does with every run.
 */
function follow(entry) {
  const [value, setValue] = createSignal(undefined, { equals: false })
  createEffect(() => {
    const e = entry()
    setValue(() => e?.value) // a live handle says nothing while it is empty
    if (e?.handle) onCleanup(e.handle.subscribe((v) => setValue(() => v)))
  })
  return value
}

const PREVIEW = { pad: 6 } // px inside the preview box around the copy

/**
 * A copy of the element, scaled to fit the box and refreshed as the original
 * changes. An element this box ends up inside of — the panel showing it, say —
 * is only named: copying it would copy the copy, forever.
 */
function Preview(props) {
  const box = document.createElement("div")
  box.className = "preview"
  createEffect(() => {
    const element = props.element()
    let frame
    let named = false
    const refresh = () => {
      frame = undefined
      if (element.contains(box)) {
        if (named) return
        named = true
        box.replaceChildren(
          Object.assign(document.createElement("div"), { className: "dim", textContent: atom(element) }),
        )
        return
      }
      named = false
      const copy = element.cloneNode(true)
      box.replaceChildren(copy)
      requestAnimationFrame(() => fit(box, copy))
    }
    const schedule = () => (frame ??= requestAnimationFrame(refresh))
    const changes = new MutationObserver(schedule)
    changes.observe(element, { subtree: true, childList: true, attributes: true, characterData: true })
    const sizes = new ResizeObserver(schedule)
    sizes.observe(box)
    refresh()
    onCleanup(() => {
      changes.disconnect()
      sizes.disconnect()
      cancelAnimationFrame(frame)
    })
  })
  return box
}

/** Scales and moves `copy` so everything it draws, overflow included, sits centered in `box`. */
function fit(box, copy) {
  copy.style.transform = ""
  const drawn = bounds(copy)
  const w = drawn.right - drawn.left
  const h = drawn.bottom - drawn.top
  if (!w || !h) return
  const inner = { w: box.clientWidth - 2 * PREVIEW.pad, h: box.clientHeight - 2 * PREVIEW.pad }
  const scale = Math.min(1, inner.w / w, inner.h / h)
  const at = copy.getBoundingClientRect()
  const origin = box.getBoundingClientRect()
  const x = PREVIEW.pad + (inner.w - w * scale) / 2 - (at.left - origin.left) - (drawn.left - at.left) * scale
  const y = PREVIEW.pad + (inner.h - h * scale) / 2 - (at.top - origin.top) - (drawn.top - at.top) * scale
  copy.style.transformOrigin = "0 0"
  copy.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
}

/** The box of `el` with everything it lets overflow, as the inspector measures views. */
function bounds(el) {
  let { left, top, right, bottom } = el.getBoundingClientRect()
  visit(el)
  return { left, top, right, bottom }

  function visit(node) {
    if (getComputedStyle(node).overflow !== "visible") return
    for (const child of node.children) {
      const r = child.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      left = Math.min(left, r.left)
      top = Math.min(top, r.top)
      right = Math.max(right, r.right)
      bottom = Math.max(bottom, r.bottom)
      visit(child)
    }
  }
}

// -- wires --

function mid(rect) {
  return rect.top + rect.height / 2
}

/** An svg path from (x1, y1) to (x2, y2) in viewport coordinates, relative to `origin`, easing out and in horizontally. */
function wire(x1, y1, x2, y2, origin, kind) {
  const ax = x1 - origin.left
  const ay = y1 - origin.top
  const bx = x2 - origin.left
  const by = y2 - origin.top
  const dx = Math.max(24, (bx - ax) / 2)
  return `<path class="${kind}" d="M${ax} ${ay} C${ax + dx} ${ay}, ${bx - dx} ${by}, ${bx} ${by}" />`
}

// -- formatting values --

const LIMIT = 6 // entries shown per object or array

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
  if (depth <= 0) return `{${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""}}`
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
      return JSON.stringify(value.length > 40 ? `${value.slice(0, 37)}…` : value)
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
  if (Array.isArray(value)) return undefined
  const proto = Object.getPrototypeOf(value)
  if (proto && proto !== Object.prototype && value.constructor?.name) return `${value.constructor.name} {…}`
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
.behavior-graph { height: 100%; min-width: 0; overflow: auto; font: 12px/1.5 ui-monospace, Menlo, monospace; color: #222; }
.behavior-graph .board { position: relative; box-sizing: border-box; min-height: 100%; min-width: max-content;
  display: flex; align-items: center; gap: 40px; padding: 12px; }
.behavior-graph .wires { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.behavior-graph .wires path { fill: none; stroke: #222; stroke-width: 1.5; stroke-linecap: round; }
.behavior-graph .wires path.get { stroke: #bbb; stroke-dasharray: 4 3; }
.behavior-graph .column { position: relative; display: flex; flex-direction: column; justify-content: center; gap: 12px; }
.behavior-graph .node { min-width: 120px; max-width: 220px; padding: 6px 8px; border: 1.5px solid #222; border-radius: 6px;
  background: #fff; }
.behavior-graph .node.get { border-color: #bbb; }
.behavior-graph .node.get .key { color: #7a9cc9; }
.behavior-graph .node .key { color: #0550ae; font-weight: bold; overflow-wrap: anywhere; }
.behavior-graph .node .value { margin: 2px 0 0; font: inherit; white-space: pre-wrap; word-break: break-all; color: #444; }
.behavior-graph .center { border-width: 2px; }
.behavior-graph .name { font-weight: bold; font-size: 13px; }
.behavior-graph .dim { color: #999; overflow-wrap: anywhere; }
.behavior-graph .active { color: #2a9d5c; }
.behavior-graph .error { color: #c0392b; overflow-wrap: anywhere; }
.behavior-graph .placeholder { color: #bbb; font-style: italic; }
.behavior-graph .preview { position: relative; width: 200px; height: 130px; margin-top: 4px; overflow: hidden;
  border: 1px solid #eee; border-radius: 3px; background: #fff; }
.behavior-graph .preview > * { position: absolute; left: 0; top: 0; margin: 0; pointer-events: none; }
.behavior-graph .preview > .dim { position: static; }
`
