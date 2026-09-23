import { onCleanup } from "solid-js"
import { createEnvironment, wrap, type Record } from "./runtime"
import { importBehavior } from "./behaviors"
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
  canvas.load(record)
  onCleanup(() => root.close())

  const reset = () => {
    localStorage.removeItem(STORAGE)
    location.reload()
  }

  return (
    <div class="app">
      <div class="stage-column">
        {stage}
        <button class="reset" onClick={reset}>Reset canvas</button>
      </div>
      <Inspector env={canvas} record={record} />
    </div>
  )
}
