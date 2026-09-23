import { field, type Behavior, type Environment, type Id, type Record } from "../runtime"

// One environment per shape; owns their lifetimes.
export default {
  title: "Canvas",
  description: `
Gives each entry of \`shapes\` its own environment and an element on the
canvas. The shape's record is loaded into the environment, so the shape's
own behaviors (*Stroke*, *Rect*) render it. Switch this off and the shapes
disappear from the canvas but stay in the record.
`,
  mount(env: Environment) {
    const dom = env.get<HTMLElement>("dom").value
    const shapes = env.get<{ [id: Id]: Record }>("shapes")
    const children = new Map<Id, { env: Environment; el: HTMLElement }>()

    const stop = shapes.subscribe((all) => {
      for (const id of Object.keys(all)) {
        if (children.has(id)) continue
        const el = dom.appendChild(document.createElement("div"))
        el.className = "shape"
        const child = env.fork()
        child.put("dom", el)
        child.load(field(shapes, id))
        children.set(id, { env: child, el })
      }
      for (const [id, c] of children) {
        if (id in all) continue
        c.env.close()
        c.el.remove()
        children.delete(id)
      }
    })

    return () => {
      stop()
      for (const c of children.values()) {
        c.env.close()
        c.el.remove()
      }
    }
  },
} satisfies Behavior
