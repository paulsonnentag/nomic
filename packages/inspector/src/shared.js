import { createSignal, onCleanup, Show } from "solid-js"
import html from "solid-js/html"

// What the dock (this package) and the panels (`components/inspector`) share:
// finding views in the tree of environments, their boxes on the page, the
// highlight drawn around one, and the select button. The panels import it as
// `inspector`.

// -- finding views --

/** The environment with no parent above `env`. */
export function rootOf(env) {
  let current = env
  while (current.parent) current = current.parent
  return current
}

/** Every environment under `root` (inclusive) with its own `dom` in the document, with that element. */
export function views(root) {
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
export function chain(env) {
  const out = []
  for (let current = env; current; current = current.parent) out.push(current)
  return out
}

/** The element a view shows itself with: what is bound at `dom` in its own environment, while it is in the page. */
export function domOf(env) {
  const dom = env.own("dom").value
  return dom instanceof Element && dom.isConnected ? dom : undefined
}

/** What to call an environment: the type of the data it shows, or root. */
export function titleOf(env) {
  if (!env.parent) return "root"
  const data = env.inspect().bindings.find((b) => b.key === "data")?.handle.value
  return data?.["@patchwork"]?.type ?? "view"
}

// -- hit testing --

const SLACK = 4 // px around a view's bounds that still count as hitting it, for thin drawings

/** The innermost view whose bounds contain the point; of overlapping siblings, the later one. */
export function hit(list, x, y) {
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
export function bounds(dom) {
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
export function measured(measure) {
  const [box, setBox] = createSignal(measure())
  let frame = requestAnimationFrame(tick)
  onCleanup(() => cancelAnimationFrame(frame))
  return box

  function tick() {
    frame = requestAnimationFrame(tick)
    const next = measure()
    const current = box()
    if (
      (next === undefined) !== (current === undefined) ||
      (next &&
        (next.left !== current.left ||
          next.top !== current.top ||
          next.right !== current.right ||
          next.bottom !== current.bottom))
    )
      setBox(next)
  }
}

const LABEL = 18 // px the label under a highlight needs; tucked inside when the box is closer to the bottom

/**
 * Outlines the view `env` in `color`, inside its bounds so the edges show even
 * at the viewport's: dashed as a preview while selecting, solid for the view
 * an inspector shows. The label sits under the box at its left, or inside it
 * near the bottom of the viewport. Drawn under the dock, so panels cover it — except for a
 * panel itself, or what is shown in one, which is outlined over the dock.
 * Nothing while the view has no element in the page.
 */
export function Highlight(props) {
  const box = measured(() => {
    const dom = domOf(props.env())
    return dom && bounds(dom)
  })
  const inDock = () => domOf(props.env())?.closest(".nomic-inspector-dock") !== null
  return html`<${Show} when=${box}>
    <div
      class=${() =>
        `nomic-inspector-highlight${props.dashed ? " dashed" : ""}${inDock() ? " above" : ""}${window.innerHeight - box().bottom < LABEL ? " tucked" : ""}`}
      style=${() => {
        const b = box()
        return `--color:${props.color};left:${b.left}px;top:${b.top}px;width:${b.right - b.left}px;height:${b.bottom - b.top}px`
      }}
    >
      <span>${() => titleOf(props.env())}</span>
    </div>
  <//>`
}

/** The button that toggles selecting: a selection box with an arrow into it, filled in `color` while active. */
export function SelectButton(props) {
  return html`<button
    class=${() => `nomic-inspector-button nomic-inspector-select${props.active() ? " active" : ""}`}
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

/** Styles for the buttons and the highlight; the dock and every panel include them. */
export const SHARED_CSS = `
.nomic-inspector-button { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;
  padding: 0; border: 1px solid #ccc; border-radius: 4px; background: #fff; color: #222; font: inherit; cursor: pointer; }
.nomic-inspector-button:hover { background: #f2f2f2; }
.nomic-inspector-select { border-color: color-mix(in srgb, var(--color) 40%, transparent); color: var(--color);
  background: color-mix(in srgb, var(--color) 12%, #fff); }
.nomic-inspector-select:hover { background: color-mix(in srgb, var(--color) 22%, #fff); }
.nomic-inspector-select.active { border-color: var(--color); color: #fff; background: var(--color); }
.nomic-inspector-highlight { position: fixed; z-index: 2147482999; pointer-events: none;
  outline: 2px solid var(--color); outline-offset: -2px; }
.nomic-inspector-highlight.above { z-index: 2147483002; }
.nomic-inspector-highlight.dashed { outline-style: dashed; background: color-mix(in srgb, var(--color) 12%, transparent); }
.nomic-inspector-highlight > span { position: absolute; left: 0; top: 100%; padding: 0 4px;
  font: 11px/1.5 ui-monospace, Menlo, monospace; color: #fff; background: var(--color); white-space: nowrap; }
.nomic-inspector-highlight.tucked > span { top: auto; bottom: 0; }
`
