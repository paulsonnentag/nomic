import { createSignal, onCleanup, Show } from "solid-js"
import { createEnvironment, wrap, type Environment, type Record } from "./runtime"
import { importBehavior } from "./behaviors"
import { environmentAt, lookup, register } from "./registry"
import { seed } from "./seed"
import { Inspector } from "./Inspector"

const STORAGE = "nomic:canvas"

export function App() {
  // The record is the serialization. Every change to a declared value, at any
  // depth, is a change to `record`, so this subscription is all of persistence.
  const stored = localStorage.getItem(STORAGE)
  const record = wrap<Record>(stored ? JSON.parse(stored) : structuredClone(seed))
  record.subscribe((r) => localStorage.setItem(STORAGE, JSON.stringify(r)))

  // The stage is made before the canvas loads, so that `dom` is there for the
  // first behavior that asks for it.
  const stage = document.createElement("div")
  stage.className = "stage"

  const root = createEnvironment({ import: importBehavior })
  root.put("dom", stage)
  const canvas = root.fork()
  register(stage, canvas, "canvas")
  canvas.load(record)
  onCleanup(() => root.close())

  const [inspected, setInspected] = createSignal<Environment>(canvas)
  const [inspecting, setInspecting] = createSignal(false)
  const [hover, setHover] = createSignal<{ el: Element; rect: DOMRect } | undefined>()

  let column!: HTMLDivElement
  const move = (e: PointerEvent) => setHover(environmentAt(e.clientX, e.clientY, stage))
  const pick = () => {
    const h = hover()
    if (h) setInspected(lookup(h.el)!.env)
    setInspecting(false)
    setHover(undefined)
  }
  // The highlight is positioned relative to the stage column.
  const local = (r: DOMRect) => {
    const c = column.getBoundingClientRect()
    return { left: `${r.left - c.left}px`, top: `${r.top - c.top}px`, width: `${r.width}px`, height: `${r.height}px` }
  }

  const reset = () => {
    localStorage.removeItem(STORAGE)
    location.reload()
  }

  return (
    <div class="app">
      <div class="stage-column" ref={column}>
        {stage}
        <button class="reset" onClick={reset}>Reset canvas</button>
        <Show when={inspecting()}>
          <div class="inspect-layer" onPointerMove={move} onPointerLeave={() => setHover(undefined)} onClick={pick}>
            <Show when={hover()}>
              {(h) => (
                <div class="inspect-box" style={local(h().rect)}>
                  <span class="inspect-label">{lookup(h().el)?.label}</span>
                </div>
              )}
            </Show>
          </div>
        </Show>
      </div>
      <Inspector
        env={inspected()}
        inspecting={inspecting()}
        onInspect={() => setInspecting(!inspecting())}
        onSelect={setInspected}
      />
    </div>
  )
}
