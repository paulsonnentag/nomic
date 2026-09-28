import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { Portal, render } from "solid-js/web"
import html from "solid-js/html"

/** Shown in every panel header, so it is visible which inspector the page runs. Bump it with changes. */
const VERSION = "0.0.8"

/** Highlight colors, one per open inspector, in the order they are opened. */
const COLORS = ["#4a8cf7", "#d6409f", "#2a9d5c", "#e0851a", "#7c5cd6"]

/**
 * Point at a view to see its environment: the bindings made there and who made
 * them, the behaviors attached and the package each came from, and the live
 * values, from the root down. The select button (or ⌥I) starts selecting: an
 * overlay takes the pointer and the view under it is highlighted; a click
 * picks it and ends selecting, so the page is interactive again. Escape
 * cancels. The button floats at the top right while no inspector is open, and
 * then sits in each panel's header, so a pick made from a panel shows the
 * picked view in that panel.
 *
 * Inspectors are views too — a fork of the root whose state is the `data`
 * handle and whose panel is the `dom` — so a panel can be picked like anything
 * else; that opens a new inspector to its right, which shows the picked
 * inspector's state live. Panels slide in from the right into the dock at the
 * right edge.
 *
 * In a panel, sections are selectable, so the behaviors of any environment in
 * the chain can be browsed; selecting a behavior shows the layer it sees the
 * environment through and its source. Attached to the root environment, so it
 * finds every view on the page by walking the forks below it.
 */
export default function inspector(env) {
  const core = env.get("imports/core").value
  const { useHandle } = env.get("imports/solid").value
  const repo = env.get("repo").value
  const root = rootOf(env)

  const dock = document.createElement("div")
  dock.className = "nomic-inspector-dock"
  document.body.append(dock)
  const panels = document.createElement("div")
  panels.className = "panels"
  const instances = [] // open inspectors, left to right, as their panels stand in the dock
  const tracked = () => [...dock.querySelectorAll(".bar, .panels > *")] // what moves when the dock changes
  const [count, setCount] = createSignal(0) // how many are open, for the floating button
  let opened = 0

  // Selecting: while the overlay is up, `selecting()` is { by }, the inspector the pick goes to (none before the first).
  const [selecting, setSelecting] = createSignal()
  const [hovered, setHovered] = createSignal() // while selecting, the view under the pointer: { env, dom }
  const start = (by) => {
    setHovered(undefined)
    setSelecting({ by })
  }
  const stop = () => {
    setSelecting(undefined)
    setHovered(undefined)
  }
  const toggle = (by) => (selecting() ? stop() : start(by))
  const pick = () => {
    const picked = hovered()
    const by = selecting()?.by
    stop()
    if (picked) show(picked, by)
  }
  const onKey = (e) => {
    if (e.altKey && e.code === "KeyI") toggle(instances[0])
    else if (e.key === "Escape" && selecting()) stop()
  }
  window.addEventListener("keydown", onKey)

  /**
   * Shows `picked`, selected from the inspector `by` (none when there is no
   * inspector yet): a picked panel opens a new inspector right of it, unless
   * one shows it already; anything else replaces what `by` shows.
   */
  const show = (picked, by) => {
    const inspected = instances.find((i) => i.view === picked.env)
    if (inspected) {
      const already = instances.find((i) => i.targets(picked))
      if (already) already.retarget(picked)
      else spawn(picked, instances.indexOf(inspected) + 1)
    } else if (by) by.retarget(picked)
    else spawn(picked, 0)
  }
  /** Opens an inspector of `picked` at `index` in the dock, sliding in from the right. */
  const spawn = (picked, index) => {
    const instance = openInspector({ ...shared, color: COLORS[opened++ % COLORS.length], target: picked, close })
    instances.splice(index, 0, instance)
    setCount(instances.length)
    layout(tracked, () => panels.insertBefore(instance.dom, panels.children[index] ?? null), instance.dom)
    function close() {
      instances.splice(instances.indexOf(instance), 1)
      setCount(instances.length)
      layout(tracked, () => instance.dispose())
    }
  }

  const shared = {
    root,
    names: resolved(packagePaths(repo, env.get("packages").value, core), new Map()),
    useHandle,
    createHandle: core.createHandle,
    source: (behavior) => core.fileText(repo, behavior.pin, behavior.module),
    selecting,
    toggle,
  }
  const dispose = render(() => Launcher({ root, panels, count, selecting, hovered, setHovered, toggle, pick }), dock)
  return () => {
    for (const instance of [...instances]) instance.dispose()
    window.removeEventListener("keydown", onKey)
    dispose()
    dock.remove()
  }
}

/**
 * The dock at the right edge: the select button, floating at the top right
 * while no inspector is open, and the row the panels stand in. While
 * selecting, an overlay takes the pointer, the view under it is highlighted in
 * the color of the inspector the pick goes to, and a click picks it.
 */
function Launcher(props) {
  const color = () => props.selecting()?.by?.color ?? COLORS[0]
  return html`
    <style>
      ${CSS}
    </style>
    <${Show} when=${() => props.count() === 0}>
      <div class="bar">
        ${() =>
          SelectButton({
            active: () => props.selecting() !== undefined,
            onClick: () => props.toggle(undefined),
            color: COLORS[0],
          })}
      </div>
    <//>
    ${props.panels}
    <${Portal}>
      <${Show} when=${props.selecting}>
        <div
          class="nomic-inspector-overlay"
          onPointerMove=${(e) => props.setHovered(hit(views(props.root), e.clientX, e.clientY))}
          onClick=${props.pick}
        ></div>
        <${Show} when=${props.hovered}>${() => Highlight({ view: props.hovered, dashed: true, color: color() })}<//>
      <//>
    <//>
  `
}

/** The button that toggles selecting: a selection box with an arrow into it, filled in `color` while active. */
function SelectButton(props) {
  return html`<button
    class=${() => `nomic-inspector-select${props.active() ? " active" : ""}`}
    style=${`--color:${props.color}`}
    title=${() => (props.active() ? "Stop selecting (Esc)" : "Select a view to inspect (⌥I)")}
    onClick=${props.onClick}
    innerHTML=${SELECT_ICON}
  ></button>`
}

const SELECT_ICON = `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none"
    stroke="currentColor" stroke-linejoin="round">
  <path d="M10 16.5 H2.5 V2.5 H16.5 V10" stroke-width="1.5" stroke-dasharray="1.5 1.5" />
  <path d="M17.5 17.5 L7.5 7.5" stroke-width="1.8" stroke-linecap="round" />
  <path d="M7.5 12 V7.5 H12" stroke-width="1.8" stroke-linecap="round" />
</svg>`

// -- one inspector --

const MOTION = { duration: 420, easing: "cubic-bezier(.2, .8, .2, 1)" }

/**
 * Applies `mutate` and animates the difference among the elements `tracked`
 * lists before and after: every one that moved slides from where it was, and
 * `entering` slides in from the right of its place.
 */
function layout(tracked, mutate, entering) {
  const before = new Map(tracked().map((el) => [el, el.getBoundingClientRect()]))
  mutate()
  for (const el of tracked()) {
    const after = el.getBoundingClientRect()
    const was = before.get(el)
    if (was) {
      const dx = was.left - after.left
      if (dx) el.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], MOTION)
    } else if (el === entering) {
      el.animate(
        [
          { transform: "translateX(100%)", opacity: 0 },
          { transform: "none", opacity: 1 },
        ],
        MOTION,
      )
    }
  }
}

/**
 * Opens an inspector of `target` as a view of its own state: a fork of the root
 * with the state handle at `data` and the panel at `dom`, so it is inspectable
 * like any view. The panel is not placed; the caller puts it in the dock.
 */
function openInspector(shared) {
  const view = shared.root.fork()
  const data = shared.createHandle({
    "@patchwork": { type: "inspector" },
    target: shared.target, // the inspected view: { env, dom }
    environment: undefined, // the selected environment in the chain; the target's when unset
    behavior: undefined, // the `by` of the selected behavior of that environment
  })
  const dom = document.createElement("aside")
  dom.className = "nomic-inspector-panel"
  view.put("data", data)
  view.put("dom", dom)
  const instance = {
    view,
    dom,
    color: shared.color,
    targets: (picked) => data.value.target?.env === picked.env,
    /** Shows `picked` instead; the panel blinks to say so. */
    retarget(picked) {
      data.change((s) => {
        s.target = picked
        s.environment = s.behavior = undefined
      })
      dom.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 300 })
    },
    dispose() {
      dispose()
      dom.remove()
      view.destroy()
    },
  }
  const dispose = render(
    () =>
      Inspector({
        ...shared,
        view,
        data,
        dom,
        select: () => shared.toggle(instance),
        selecting: () => shared.selecting()?.by === instance,
      }),
    dom,
  )
  return instance
}

function Inspector(props) {
  const state = props.useHandle(props.data)
  const version = watchTree(props.root) // bumps when the tree of environments changes
  const change = (fn) => props.data.change(fn)

  /** The inspected view, while it is still in the page. */
  const target = () => {
    version()
    const t = state().target
    return t?.dom.isConnected ? t : undefined
  }
  /** The environment whose behaviors are shown: the selected section, or the target's. */
  const environment = () => state().environment ?? target()?.env
  const behaviors = () => (environment() ? (version(), environment().inspect().behaviors) : [])
  const behavior = () => behaviors().find((b) => b.by === state().behavior)
  /** Root first, down to the target's environment; the selected behavior's layer sits under the environment it fronts. */
  const sections = () => {
    if (!target()) return []
    const list = chain(target().env).reverse()
    const layer = behavior()?.layer
    if (layer) list.splice(list.indexOf(environment()) + 1, 0, layer)
    return list
  }
  createEffect(() => {
    version()
    if (state().target && !state().target.dom.isConnected) {
      change((s) => {
        s.target = s.environment = s.behavior = undefined // the target left the page
      })
    }
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

  return html`
    <div class="resize" onPointerDown=${(e) => resize(e, props.dom)}></div>
    <header>
      ${() => SelectButton({ active: props.selecting, onClick: props.select, color: props.color })}
      <span class="name">inspector <span class="dim">${VERSION}</span></span>
      <button class="close" title="Close" onClick=${props.close}>×</button>
    </header>
    <${Show} when=${target} fallback=${html`<div class="empty">the inspected view left the page</div>`}>
      <div class="bindings">
        <${For} each=${sections}
          >${(env) =>
            EnvSection({
              env,
              selected: () => env === environment(),
              select: () => selectEnvironment(env),
              behavior,
              version,
              names: props.names,
              useHandle: props.useHandle,
            })}<//
        >
      </div>
      <div class="behaviors">
        ${() => BehaviorTree({ behaviors, selected: behavior, select: selectBehavior, names: props.names })}
        ${() => BehaviorDetail({ behavior, names: props.names, source: props.source })}
      </div>
    <//>
    <${Portal}>
      <${Show} when=${target}>${() => Highlight({ view: target, dashed: false, color: props.color })}<//>
    <//>
  `
}

const WIDTH = { min: 320, margin: 80 } // px: the narrowest panel, and the page kept visible beside the dock

/** Drags the left edge of `panel` from the pointer event `e`: the panel grows to the left, up to the viewport. */
function resize(e, panel) {
  const handle = e.currentTarget
  const start = { x: e.clientX, width: panel.getBoundingClientRect().width }
  const max = () => window.innerWidth - WIDTH.margin - (panel.parentElement.getBoundingClientRect().width - start.width)
  const move = (ev) => {
    const width = Math.max(WIDTH.min, Math.min(max(), start.width + start.x - ev.clientX))
    panel.style.width = `${width}px`
  }
  const stop = () => {
    handle.removeEventListener("pointermove", move)
    handle.removeEventListener("pointerup", stop)
    handle.removeEventListener("pointercancel", stop)
    handle.classList.remove("dragging")
  }
  handle.setPointerCapture(e.pointerId)
  handle.classList.add("dragging")
  handle.addEventListener("pointermove", move)
  handle.addEventListener("pointerup", stop)
  handle.addEventListener("pointercancel", stop)
  e.preventDefault()
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

/** A signal holding `initial` until `promise` resolves, then its value. */
function resolved(promise, initial) {
  const [value, setValue] = createSignal(initial)
  promise.then((v) => setValue(() => v)).catch(console.error)
  return value
}

// -- finding views --

/** The environment with no parent above `env`. */
function rootOf(env) {
  let current = env
  while (current.parent) current = current.parent
  return current
}

/** Every environment under `root` (inclusive) with its own `dom` in the document, with that element. */
function views(root) {
  const out = []
  visit(root)
  return out

  function visit(env) {
    const { bindings, forks } = env.inspect()
    const dom = bindings.find((b) => b.key === "dom")?.handle.value
    if (dom instanceof Element && dom.isConnected) out.push({ env, dom })
    for (const fork of forks) visit(fork)
  }
}

/** `env` and its parents, nearest first. */
function chain(env) {
  const out = []
  for (let current = env; current; current = current.parent) out.push(current)
  return out
}

// -- hit testing --

const SLACK = 4 // px around a view's bounds that still count as hitting it, for thin drawings

/** The innermost view whose bounds contain the point; of overlapping siblings, the later one. */
function hit(list, x, y) {
  let best
  for (const view of list) {
    const b = bounds(view.dom)
    if (x < b.left - SLACK || x > b.right + SLACK || y < b.top - SLACK || y > b.bottom + SLACK) continue
    if (!best || !view.dom.contains(best.dom)) best = view
  }
  return best
}

/**
 * The viewport box of `dom` together with everything it lets overflow: a view
 * may be a point whose drawing extends from it. An element that clips its
 * content (overflow other than visible) is only its own box.
 */
function bounds(dom) {
  const box = dom.getBoundingClientRect()
  let { left, top, right, bottom } = box
  visit(dom)
  return { left, top, right, bottom }

  function visit(el) {
    if (getComputedStyle(el).overflow !== "visible") return
    for (const child of el.children) {
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

// -- components --

/**
 * A signal holding `measure()`, re-measured every frame while mounted and
 * changed only when the box differs: views move — panels slide, the page
 * scrolls, drawings grow — and the highlight follows.
 */
function measured(measure) {
  const [box, setBox] = createSignal(measure())
  let frame = requestAnimationFrame(tick)
  onCleanup(() => cancelAnimationFrame(frame))
  return box

  function tick() {
    frame = requestAnimationFrame(tick)
    const next = measure()
    const current = box()
    if (
      next.left !== current.left ||
      next.top !== current.top ||
      next.right !== current.right ||
      next.bottom !== current.bottom
    )
      setBox(next)
  }
}

const LABEL = 18 // px the label above a highlight needs; tucked inside when the box is closer to the top

/**
 * Outlines a view in `color`, inside its bounds so the edges show even at the
 * viewport's: dashed as a preview while selecting, solid for the view an
 * inspector shows. The label sits above the box, or inside it near the top of
 * the viewport. Drawn under the dock, so panels cover it — except for a panel
 * itself, which is outlined over the dock.
 */
function Highlight(props) {
  const box = measured(() => bounds(props.view().dom))
  const inDock = () => props.view().dom.closest(".nomic-inspector-dock") !== null
  return html`<div
    class=${() =>
      `nomic-inspector-highlight${props.dashed ? " dashed" : ""}${inDock() ? " above" : ""}${box().top < LABEL ? " tucked" : ""}`}
    style=${() => {
      const b = box()
      return `--color:${props.color};left:${b.left}px;top:${b.top}px;width:${b.right - b.left}px;height:${b.bottom - b.top}px`
    }}
  >
    <span>${() => titleOf(props.view().env)}</span>
  </div>`
}

/** One environment's own bindings; its title selects it. A layer is only shown for the behavior it fronts, so it is not selectable. */
function EnvSection(props) {
  const info = createMemo(() => (props.version(), props.env.inspect()))
  const layer = props.env.kind === "layer"
  const dom = () => info().bindings.find((b) => b.key === "dom")?.handle.value
  const subtitle = () => (layer ? packageName(props.behavior()?.package, props.names()) : atom(dom()))
  return html`<section class=${() => `${layer ? "layer" : ""}${props.selected() ? " selected" : ""}`}>
    <h2 onClick=${() => !layer && props.select()}>
      ${() => (layer ? "layer" : titleOf(props.env))}
      <${Show} when=${() => layer || dom() instanceof Element}>
        <span class="dim">${subtitle}</span>
      <//>
    </h2>
    <${Show} when=${() => info().bindings.length} fallback=${html`<div class="dim">no bindings</div>`}>
      <table>
        <${For} each=${() => info().bindings.map((b) => b.handle)}
          >${(handle) => BindingRow({ handle, info, useHandle: props.useHandle })}<//
        >
      </table>
    <//>
  </section>`
}

/**
 * A binding: its key, the behavior that put it, and the value, live; the value
 * expands. Keyed by the handle, which lives as long as the binding does, so a
 * row keeps its state across changes to the rest of the environment.
 */
function BindingRow(props) {
  const binding = () => props.info().bindings.find((b) => b.handle === props.handle)
  const value = props.useHandle(props.handle)
  const [expanded, setExpanded] = createSignal(false)
  // The attachment that put the binding, by the behavior's name when it is one attached here.
  const by = () => binding()?.by ?? ""
  const attribution = () => props.info().behaviors.find((b) => b.by === by())?.name ?? by()
  return html`<tr>
    <td class="key">${() => binding()?.key}</td>
    <td class="by" title=${by}>${attribution}</td>
    <td>
      <details onToggle=${(e) => setExpanded(e.currentTarget.open)}>
        <summary><span class="value">${() => format(value(), 0)}</span></summary>
        <${Show} when=${expanded}><pre>${() => format(value(), 3)}</pre><//>
      </details>
      <${Show} when=${typeof props.handle.url === "string"}><div class="dim">${props.handle.url}</div><//>
    </td>
  </tr>`
}

/** The behaviors of the selected environment, grouped by the package they came from; clicking one selects it. */
function BehaviorTree(props) {
  return html`<div class="tree">
    <${Show} when=${() => props.behaviors().length} fallback=${html`<div class="dim">no behaviors</div>`}>
      <${For} each=${() => groups(props.behaviors())}
        >${([, list]) =>
          html`<div class="group">
            <div class="pkg">${() => packageName(list[0].package, props.names())}</div>
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

/** The selected behavior: where it came from and the source of its module, at the pin it was mounted from. */
function BehaviorDetail(props) {
  const b = () => props.behavior()
  // Keyed by pin and module, so the tree changing under the same behavior does not refetch.
  const [source] = createResource(
    () => (b()?.pin && b()?.module ? `${b().pin} ${b().module}` : undefined),
    () => props.source(b()),
  )
  return html`<div class="detail">
    <${Show} when=${b} fallback=${html`<div class="dim">select a behavior</div>`}>
      <h2>${() => b()?.name}</h2>
      <div class="dim">
        ${() => packageName(b()?.package, props.names())}${() => (b()?.module ? ` · ${b().module}` : "")}
      </div>
      <${Show} when=${() => b()?.pin}><div class="dim">${() => b()?.by}</div><//>
      <${Show} when=${() => !source.loading} fallback=${html`<div class="dim">loading…</div>`}>
        <${Show}
          when=${() => source() !== undefined}
          fallback=${html`<div class="dim">
            ${() => (source.error ? `⚠ ${source.error.message ?? source.error}` : "no source: not mounted from a package")}
          </div>`}
        >
          <pre class="source">${source}</pre>
        <//>
      <//>
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
  return names.get(url) ?? url
}

/** What to call an environment: the type of the data it shows, or root. */
function titleOf(env) {
  if (!env.parent) return "root"
  const data = env.inspect().bindings.find((b) => b.key === "data")?.handle.value
  return data?.["@patchwork"]?.type ?? "view"
}

/** Package url → path in the checkout, from the folder docs under `root`. A package is a folder holding a manifest.json. */
async function packagePaths(repo, root, { entriesAt, headless }) {
  const paths = new Map()
  await visit(root, "")
  return paths

  async function visit(url, path) {
    const entries = await entriesAt(repo, url, "")
    if (entries.some((e) => e.name === "manifest.json")) {
      paths.set(headless(url), path)
      return
    }
    for (const entry of entries) {
      if (entry.type === "folder") await visit(headless(entry.url), path ? `${path}/${entry.name}` : entry.name)
    }
  }
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
.nomic-inspector-dock { position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147483000; display: flex;
  align-items: stretch; font: 12px/1.5 ui-monospace, Menlo, monospace; color: #222; text-align: left; }
.nomic-inspector-dock .bar { flex: none; align-self: flex-start; padding: 8px; }
.nomic-inspector-dock .bar .nomic-inspector-select { box-shadow: 0 1px 4px rgba(0,0,0,.12); }
.nomic-inspector-dock .panels { flex: none; display: flex; }
.nomic-inspector-select, .nomic-inspector-panel header .close { display: inline-flex; align-items: center;
  justify-content: center; width: 28px; height: 28px; padding: 0; border: 1px solid #ccc; border-radius: 4px;
  background: #fff; color: #222; font: inherit; cursor: pointer; }
.nomic-inspector-panel header .close:hover { background: #f2f2f2; }
.nomic-inspector-select { border-color: color-mix(in srgb, var(--color) 40%, transparent); color: var(--color);
  background: color-mix(in srgb, var(--color) 12%, #fff); }
.nomic-inspector-select:hover { background: color-mix(in srgb, var(--color) 22%, #fff); }
.nomic-inspector-select.active { border-color: var(--color); color: #fff; background: var(--color); }
.nomic-inspector-overlay { position: fixed; inset: 0; z-index: 2147483003; cursor: crosshair; }
.nomic-inspector-highlight { position: fixed; z-index: 2147482999; pointer-events: none;
  outline: 2px solid var(--color); outline-offset: -2px; }
.nomic-inspector-highlight.above { z-index: 2147483002; }
.nomic-inspector-highlight.dashed { outline-style: dashed; background: color-mix(in srgb, var(--color) 12%, transparent); }
.nomic-inspector-highlight > span { position: absolute; left: 0; bottom: 100%; padding: 0 4px;
  font: 11px/1.5 ui-monospace, Menlo, monospace; color: #fff; background: var(--color); white-space: nowrap; }
.nomic-inspector-highlight.tucked > span { bottom: auto; top: 0; }
.nomic-inspector-panel { position: relative; width: 520px; flex: none; display: flex; flex-direction: column; background: #fff;
  border-left: 1px solid #ddd; box-shadow: -4px 0 16px rgba(0,0,0,.08); }
.nomic-inspector-panel .resize { position: absolute; top: 0; bottom: 0; left: 0; width: 6px; cursor: col-resize; z-index: 1; }
.nomic-inspector-panel .resize:hover, .nomic-inspector-panel .resize.dragging { background: color-mix(in srgb, #4a8cf7 35%, transparent); }
.nomic-inspector-panel header { display: flex; align-items: center; gap: 8px; padding: 6px 10px;
  border-bottom: 1px solid #eee; font-weight: bold; }
.nomic-inspector-panel header .name { flex: 1; }
.nomic-inspector-panel header .name .dim { font-weight: normal; }
.nomic-inspector-panel .bindings { flex: none; max-height: 50%; overflow: auto; border-bottom: 1px solid #ddd; }
.nomic-inspector-panel section { padding: 6px 10px; border-bottom: 1px solid #eee; }
.nomic-inspector-panel section:last-child { border-bottom: 0; }
.nomic-inspector-panel section h2 { cursor: pointer; }
.nomic-inspector-panel section h2:hover { background: #f6f6f6; }
.nomic-inspector-panel section.layer h2 { cursor: default; background: none; }
.nomic-inspector-panel section.selected h2 { color: #4a8cf7; }
.nomic-inspector-panel h2 { margin: 0 0 4px; font-size: 13px; }
.nomic-inspector-panel h2 .dim { margin-left: 8px; font-weight: normal; }
.nomic-inspector-panel table { width: 100%; border-collapse: collapse; }
.nomic-inspector-panel td { padding: 1px 8px 1px 0; vertical-align: top; }
.nomic-inspector-panel td:last-child { padding-right: 0; width: 100%; }
.nomic-inspector-panel td.key { color: #0550ae; white-space: nowrap; }
.nomic-inspector-panel .by, .nomic-inspector-panel .dim { color: #999; }
.nomic-inspector-panel td.by { white-space: nowrap; }
.nomic-inspector-panel .empty { padding: 20px 10px; color: #888; }
.nomic-inspector-panel summary { cursor: pointer; }
.nomic-inspector-panel pre { margin: 2px 0 4px; padding: 4px; max-height: 300px; overflow: auto;
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
.nomic-inspector-panel .detail h2 { cursor: default; }
.nomic-inspector-panel .detail pre.source { flex: 1; max-height: none; margin: 6px 0 0; padding: 8px;
  white-space: pre; word-break: normal; overflow: auto; tab-size: 2; }
`
