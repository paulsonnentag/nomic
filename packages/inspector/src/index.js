import { createSignal, Show } from "solid-js"
import { Portal, render } from "solid-js/web"
import html from "solid-js/html"
import { Highlight, hit, rootOf, SelectButton, SHARED_CSS, views } from "./shared.js"

/** Highlight colors, one per open inspector, in the order they are opened. */
const COLORS = ["#4a8cf7", "#d6409f", "#2a9d5c", "#e0851a", "#7c5cd6"]

/**
 * The dock: point at a view to open an inspector of it. The select button (or
 * ⌥I) starts selecting: an overlay takes the pointer and the view under it is
 * highlighted; a click picks it and ends selecting, so the page is interactive
 * again. Escape cancels. The button floats at the top right while no inspector
 * is open, and then sits in each panel's header, so a pick made from a panel
 * shows the picked view in that panel. Panels slide in from the right into the
 * dock at the right edge.
 *
 * An inspector is a view like any other: a document of type `inspector` —
 * `{ target, environment, behavior, color }` — shown in a fork of the root,
 * where `components/inspector` renders the panel. So a panel can be picked like
 * anything else; that opens a new inspector to its right, which shows the
 * picked inspector's state live. The panels reach the dock through the
 * `inspector` binding this behavior puts on the root: the package names, and
 * selecting and closing on behalf of a panel. For the root environment only,
 * where there is no data: it finds every view on the page by walking the forks
 * below it.
 */
export default function inspector(env) {
  if (env.read("data/@patchwork/type") !== undefined) return
  const core = env.get("imports/core").value
  const { View } = env.get("imports/solid").value
  const repo = env.get("repo").value
  const root = rootOf(env)

  const dock = document.createElement("div")
  dock.className = "nomic-inspector-dock"
  document.body.append(dock)
  const panels = document.createElement("div")
  panels.className = "panels"
  const instances = [] // open inspectors, left to right, as their panels stand in the dock: { state, dom, retarget, dispose }
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
   * Shows the picked view, selected from the inspector `by` (none when there
   * is no inspector yet). A view that is an inspector's panel or shown inside
   * one opens a new inspector right of that one, unless an inspector shows it
   * already — retargeting the host would take away what it hosts. Anything
   * else replaces what `by` shows.
   */
  const show = ({ env, dom }, by) => {
    const host = instances.find((i) => i.dom.contains(dom))
    if (host) {
      const already = instances.find((i) => i.state.target === env)
      if (already) already.retarget(env)
      else spawn(env, instances.indexOf(host) + 1)
    } else if (by) by.retarget(env)
    else spawn(env, 0)
  }

  /**
   * Opens an inspector of the view `env` at `index` in the dock: a view of a
   * fresh inspector document. Its panel arrives once the components are
   * mounted; it slides in from the right then, and the others make room.
   */
  const spawn = (env, index) => {
    const data = core.createHandle({
      "@patchwork": { type: "inspector" },
      target: env, // the inspected view's environment; its `dom` is read live
      environment: undefined, // the selected environment in the chain; the target's when unset
      behavior: undefined, // the `by` of the selected behavior of that environment
      color: COLORS[opened++ % COLORS.length],
    })
    const dom = document.createElement("div")
    const dispose = render(() => View({ env: root, data }), dom)
    const instance = {
      state: data.value,
      dom,
      /** Shows the view `env` instead; the panel blinks to say so. */
      retarget(env) {
        data.change((s) => {
          s.target = env
          s.environment = s.behavior = undefined
        })
        dom.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 300 })
      },
      dispose() {
        dispose()
        dom.remove()
      },
    }
    instances.splice(index, 0, instance)
    setCount(instances.length)
    const before = positions(tracked)
    panels.insertBefore(dom, panels.children[index] ?? null)
    whenSized(dom, () => slide(tracked, before, dom))
  }

  /** Closes the inspector whose document holds `state`. */
  const close = (state) => {
    const instance = instances.find((i) => i.state === state)
    if (!instance) return
    instances.splice(instances.indexOf(instance), 1)
    setCount(instances.length)
    const before = positions(tracked)
    instance.dispose()
    slide(tracked, before)
  }

  // What the panels need from the dock, on the root so every panel sees it.
  env.put("inspector", {
    names: resolved(packagePaths(repo, env.get("packages").value, core), new Map()), // package url → path in the checkout
    selecting: () => selecting()?.by?.state, // the state of the inspector a pick goes to, while selecting
    toggle: (state) => toggle(instances.find((i) => i.state === state)),
    close,
  })
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
  const color = () => props.selecting()?.by?.state.color ?? COLORS[0]
  return html`
    <style>
      ${STYLES}
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
        <${Show} when=${props.hovered}
          >${() => Highlight({ env: () => props.hovered().env, dashed: true, color: color() })}<//
        >
      <//>
    <//>
  `
}

// -- motion --

const MOTION = { duration: 420, easing: "cubic-bezier(.2, .8, .2, 1)" }

/** Where the elements `tracked` lists are now, to slide them from after a change. */
function positions(tracked) {
  return new Map(tracked().map((el) => [el, el.getBoundingClientRect()]))
}

/** Slides every tracked element that moved since `before` from where it was, and `entering` in from the right of its place. */
function slide(tracked, before, entering) {
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

/** Calls `fn` once `el` has a width: when the panel behavior has put its element into the view. Before the next paint. */
function whenSized(el, fn) {
  const observer = new ResizeObserver(() => {
    if (el.getBoundingClientRect().width === 0) return
    observer.disconnect()
    fn()
  })
  observer.observe(el)
}

// -- package names --

/** A signal holding `initial` until `promise` resolves, then its value. */
function resolved(promise, initial) {
  const [value, setValue] = createSignal(initial)
  promise.then((v) => setValue(() => v)).catch(console.error)
  return value
}

/** Headless package url → path in the checkout, from the folder docs under `root`; the root itself is "". A package is a folder holding a manifest.json. */
async function packagePaths(repo, root, { entriesAt, headless }) {
  const paths = new Map([[headless(root), ""]])
  await visit(root, "")
  return paths

  async function visit(url, path) {
    const entries = await entriesAt(repo, url, "")
    if (entries.some((e) => e.name === "manifest.json")) {
      paths.set(headless(url), path)
      return
    }
    for (const entry of entries) {
      if (entry.type === "folder") await visit(entry.url, path ? `${path}/${entry.name}` : entry.name)
    }
  }
}

const STYLES =
  SHARED_CSS +
  `
.nomic-inspector-dock { position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147483000; display: flex;
  align-items: stretch; font: 12px/1.5 ui-monospace, Menlo, monospace; color: #222; text-align: left; }
.nomic-inspector-dock .bar { flex: none; align-self: flex-start; padding: 8px; }
.nomic-inspector-dock .bar .nomic-inspector-select { box-shadow: 0 1px 4px rgba(0,0,0,.12); }
.nomic-inspector-dock .panels { flex: none; display: flex; }
.nomic-inspector-dock .panels > *, .nomic-inspector-dock .panels > * > .view { flex: none; display: flex; }
.nomic-inspector-overlay { position: fixed; inset: 0; z-index: 2147483003; cursor: crosshair; }
`
