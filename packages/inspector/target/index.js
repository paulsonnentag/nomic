// Ties an inspector to its target on the canvas: outlines the target shape in
// the inspector's color, and removes the inspector's embed when the target
// shape is gone.

export default function target(env) {
  if (env.get("data/@patchwork/type").value !== "inspector") return
  const highlights = env.get("highlights")
  if (highlights.value === undefined) return
  const data = env.get("data")
  const shapes = env.get("surface/shapes")
  const key = `inspector/${data.url ?? env.id}`

  const stopMarking = data.subscribe((inspector) => {
    highlights.change((marks) => {
      marks[key] = { shape: inspector.target?.shape, color: inspector.color, dashed: false }
    })
  })
  const stopWatching = shapes.subscribe((all) => {
    const shape = data.value?.target?.shape
    if (shape !== undefined && !(shape in all)) close()
  })
  return () => {
    stopMarking()
    stopWatching()
    highlights.change((marks) => {
      delete marks[key]
    })
  }

  /** Removes the embed shape this inspector shows in: the parent view's data. */
  function close() {
    const own = env.parent?.get("data").value?.id
    if (own === undefined) return
    shapes.change((all) => {
      delete all[own]
    })
  }
}
