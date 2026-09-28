import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { render } from "solid-js/web"
import html from "solid-js/html"

/**
 * Point at a view to see its environment: the bindings made there and who made
 * them, the behaviors attached and the package each came from, and the live
 * values, up the chain to the root. A button in the top right (or ⌥I) starts
 * targeting: an overlay takes the pointer, the view under it is previewed, and
 * a click selects it. Selection ends targeting, so the page is interactive
 * again while the panel shows the selected view; Escape cancels targeting and
 * keeps the previous selection. Selecting a behavior in the panel shows the
 * environment as that behavior sees it (its layer in front of the view) and its
 * source. Attached to the root environment, so it finds every view on the page
 * by walking the forks below it.
 */
export default function inspector(env) {
  const core = env.get("imports/core").value
  const { useHandle } = env.get("imports/solid").value
  const repo = env.get("repo").value
  const container = document.createElement("div")
  document.body.append(container)
  const dispose = render(
    () =>
      Inspector({
        root: rootOf(env),
        names: packagePaths(repo, env.get("packages").value, core),
        source: (behavior) => core.fileText(repo, behavior.pin, behavior.module),
        useHandle,
      }),
    container,
  )
  return () => {
    dispose()
    container.remove()
  }
}

// -- state and modes --

function Inspector(props) {
  const version = watchTree(props.root) // bumps when the tree of environments changes
  const names = resolved(props.names, new Map())
  const [targeting, setTargeting] = createSignal(false) // the overlay is up and the pointer picks a view
  const [hovered, setHovered] = createSignal() // while targeting, the view under the pointer: { env, dom }
  const [selected, setSelected] = createSignal() // the view the panel shows once targeting is over
  const [behaviorId, setBehaviorId] = createSignal() // the `by` of the selected behavior of that view

  const open = () => targeting() || selected() !== undefined
  /** The view to show: the hovered one while targeting, else the selected one, if it is still in the page. */
  const current = () => {
    version()
    const view = targeting() ? hovered() : selected()
    return view?.dom.isConnected ? view : undefined
  }
  /** The behaviors attached to the current view, and the selected one among them while it is attached. */
  const behaviors = () => (current() ? (version(), current().env.inspect().behaviors) : [])
  const behavior = () => behaviors().find((b) => b.by === behaviorId())
  createEffect(() => {
    version()
    if (selected() && !selected().dom.isConnected) setSelected(undefined) // the selected view left the page
  })

  const start = () => {
    setHovered(undefined)
    setTargeting(true)
  }
  const stop = () => {
    setTargeting(false)
    setHovered(undefined)
  }
  const pick = () => {
    setSelected(hovered())
    setBehaviorId(undefined)
    stop()
  }
  const close = () => {
    stop()
    setSelected(undefined)
  }
  const onKey = (e) => {
    if (e.altKey && e.code === "KeyI") targeting() ? stop() : start()
    else if (e.key === "Escape" && targeting()) stop()
  }
  window.addEventListener("keydown", onKey)
  onCleanup(() => window.removeEventListener("keydown", onKey))

  return html`
    <style>
      ${CSS}
    </style>
    <${Show} when=${() => !open()}>
      <button class="nomic-inspector-button" title="Inspect a view (⌥I)" onClick=${start}>⌖ inspect</button>
    <//>
    <${Show} when=${targeting}>
      <div
        class="nomic-inspector-overlay"
        onPointerMove=${(e) => setHovered(hit(views(props.root), e.clientX, e.clientY))}
        onClick=${pick}
      ></div>
    <//>
    <${Show} when=${current}>${() => Highlight({ view: current, selected: () => !targeting() })}<//>
    <${Show} when=${open}>
      ${() =>
        Panel({
          current,
          behaviors,
          behavior,
          selectBehavior: (b) => setBehaviorId(behaviorId() === b.by ? undefined : b.by),
          targeting,
          toggleTargeting: () => (targeting() ? stop() : start()),
          close,
          version,
          names,
          source: props.source,
          useHandle: props.useHandle,
        })}
    <//>
  `
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
 * may be a point whose drawing extends from it. A clipping element is only its
 * own box.
 */
function bounds(dom) {
  const box = dom.getBoundingClientRect()
  let { left, top, right, bottom } = box
  if (getComputedStyle(dom).overflow !== "hidden") {
    for (const el of dom.querySelectorAll("*")) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      left = Math.min(left, r.left)
      top = Math.min(top, r.top)
      right = Math.max(right, r.right)
      bottom = Math.max(bottom, r.bottom)
    }
  }
  return { left, top, right, bottom }
}

// -- components --

/** Outlines the view: as a preview while targeting, as the selection once picked. */
function Highlight(props) {
  const box = createMemo(() => bounds(props.view().dom))
  return html`<div
    class=${() => `nomic-inspector-highlight${props.selected() ? " selected" : ""}`}
    style=${() => {
      const b = box()
      return `left:${b.left}px;top:${b.top}px;width:${b.right - b.left}px;height:${b.bottom - b.top}px`
    }}
  >
    <span>${() => titleOf(props.view().env)}</span>
  </div>`
}

/**
 * The panel: the bindings of the selected environment and its parents, then the
 * behaviors of the view as a tree beside the selected behavior's source. The
 * selected environment is the view's, or the layer the selected behavior sees
 * it through, which puts that behavior's `imports` first.
 */
function Panel(props) {
  const environment = () => props.behavior()?.layer ?? props.current().env
  return html`<aside class="nomic-inspector-panel">
    <header>
      <span class="name">inspector</span>
      <button
        class=${() => `target${props.targeting() ? " active" : ""}`}
        title="Pick another view (⌥I)"
        onClick=${props.toggleTargeting}
      >
        ⌖
      </button>
      <button class="close" title="Close" onClick=${props.close}>×</button>
    </header>
    <${Show} when=${props.current} fallback=${html`<div class="empty">point at a view and click to select it</div>`}>
      <div class="bindings">
        <${For} each=${() => chain(environment())}
          >${(env) =>
            EnvSection({
              env,
              behavior: props.behavior,
              version: props.version,
              names: props.names,
              useHandle: props.useHandle,
            })}<//
        >
      </div>
      <div class="behaviors">
        ${() =>
          BehaviorTree({
            behaviors: props.behaviors,
            selected: props.behavior,
            select: props.selectBehavior,
            names: props.names,
          })}
        ${() => BehaviorDetail({ behavior: props.behavior, names: props.names, source: props.source })}
      </div>
    <//>
  </aside>`
}

/** One environment's own bindings. */
function EnvSection(props) {
  const info = createMemo(() => (props.version(), props.env.inspect()))
  const dom = () => info().bindings.find((b) => b.key === "dom")?.handle.value
  const subtitle = () =>
    props.env.kind === "layer" ? packageName(props.behavior()?.package, props.names()) : atom(dom())
  return html`<section>
    <h2>
      ${() => (props.env.kind === "layer" ? "layer" : titleOf(props.env))}
      <${Show} when=${() => props.env.kind === "layer" || dom() instanceof Element}>
        <span class="dim">${subtitle}</span>
      <//>
    </h2>
    <h3>bindings</h3>
    <${Show} when=${() => info().bindings.length} fallback=${html`<div class="dim">none</div>`}>
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
  return html`<tr>
    <td class="key">${() => binding()?.key}</td>
    <td class="by">${() => binding()?.by ?? ""}</td>
    <td>
      <details onToggle=${(e) => setExpanded(e.currentTarget.open)}>
        <summary><span class="value">${() => format(value(), 0)}</span></summary>
        <${Show} when=${expanded}><pre>${() => format(value(), 3)}</pre><//>
      </details>
      <${Show} when=${typeof props.handle.url === "string"}><div class="dim">${props.handle.url}</div><//>
    </td>
  </tr>`
}

/** The behaviors of the view, grouped by the package they came from; clicking one selects it. */
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
      <h2>${() => b()?.name} <span class="dim">${() => b()?.by}</span></h2>
      <div class="dim">
        ${() => packageName(b()?.package, props.names())}${() => (b()?.module ? ` · ${b().module}` : "")}
      </div>
      <${Show} when=${() => b()?.pin}><div class="dim">${() => b()?.pin}</div><//>
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
.nomic-inspector-button, .nomic-inspector-panel header button { padding: 2px 8px; border: 1px solid #ccc;
  border-radius: 4px; background: #fff; color: #222; font: 12px/1.5 ui-monospace, Menlo, monospace; cursor: pointer; }
.nomic-inspector-button:hover, .nomic-inspector-panel header button:hover { background: #f2f2f2; }
.nomic-inspector-button { position: fixed; top: 8px; right: 8px; z-index: 2147483003; box-shadow: 0 1px 4px rgba(0,0,0,.12); }
.nomic-inspector-overlay { position: fixed; inset: 0; z-index: 2147483000; cursor: crosshair; }
.nomic-inspector-highlight { position: fixed; z-index: 2147483001; pointer-events: none;
  outline: 2px solid #4a8cf7; background: rgba(74, 140, 247, .12); }
.nomic-inspector-highlight.selected { outline-color: #d6409f; background: none; }
.nomic-inspector-highlight > span { position: absolute; left: -2px; bottom: 100%; padding: 0 4px;
  font: 11px/1.5 ui-monospace, Menlo, monospace; color: #fff; background: #4a8cf7; white-space: nowrap; }
.nomic-inspector-highlight.selected > span { background: #d6409f; }
.nomic-inspector-panel { position: fixed; top: 0; right: 0; bottom: 0; width: 720px; z-index: 2147483002;
  display: flex; flex-direction: column; background: #fff; color: #222; border-left: 1px solid #ddd;
  box-shadow: -4px 0 16px rgba(0,0,0,.08); font: 12px/1.5 ui-monospace, Menlo, monospace; text-align: left; }
.nomic-inspector-panel header { display: flex; align-items: center; gap: 6px; padding: 6px 10px;
  border-bottom: 1px solid #eee; font-weight: bold; }
.nomic-inspector-panel header .name { flex: 1; }
.nomic-inspector-panel header .target.active { border-color: #4a8cf7; color: #fff; background: #4a8cf7; }
.nomic-inspector-panel section { padding: 6px 10px; border-bottom: 1px solid #eee; }
.nomic-inspector-panel section:last-child { border-bottom: 0; }
.nomic-inspector-panel h2 { margin: 0 0 4px; font-size: 13px; }
.nomic-inspector-panel h2 .dim { margin-left: 8px; font-weight: normal; }
.nomic-inspector-panel h3 { margin: 6px 0 2px; font-size: 11px; font-weight: normal; text-transform: uppercase; color: #888; }
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
.nomic-inspector-panel .bindings { flex: none; max-height: 50%; overflow: auto; border-bottom: 1px solid #ddd; }
.nomic-inspector-panel .behaviors { display: flex; flex: 1; min-height: 0; }
.nomic-inspector-panel .tree { width: 200px; flex: none; padding: 6px 10px; overflow: auto; border-right: 1px solid #eee; }
.nomic-inspector-panel .group { margin: 2px 0 8px; }
.nomic-inspector-panel .pkg { color: #555; }
.nomic-inspector-panel .tree .behavior { display: block; width: 100%; padding: 1px 6px 1px 12px; border: 0;
  border-radius: 3px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.nomic-inspector-panel .tree .behavior:hover { background: #f2f2f2; }
.nomic-inspector-panel .tree .behavior.selected { color: #fff; background: #4a8cf7; }
.nomic-inspector-panel .detail { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 6px 10px; overflow: hidden; }
.nomic-inspector-panel .detail pre.source { flex: 1; max-height: none; margin: 6px 0 0; padding: 8px;
  white-space: pre; word-break: normal; overflow: auto; tab-size: 2; }
`
