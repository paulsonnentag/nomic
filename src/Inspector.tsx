import { createMemo, createResource, createSignal, For, onCleanup, Show, type Accessor } from "solid-js"
import { describe, type Attachment, type Environment, type Id, type SlotInfo } from "./runtime"
import { fileOf, importBehavior, sourceOf } from "./behaviors"
import { registrationOf } from "./registry"

/**
 * Shows one environment: the values visible in it, its behaviors from the
 * record with a switch each, and the description and source of the selected
 * behavior.
 */
export function Inspector(props: {
  env: Environment
  inspecting: boolean
  onInspect: () => void
  onSelect: (env: Environment) => void
}) {
  const [current, setCurrent] = createSignal<Id | null>(null)

  // The behaviors of the shown environment, live. Re-read when the environment changes.
  const behaviors = createMemo(() => {
    const [value, setValue] = createSignal<{ [id: Id]: Attachment }>({}, { equals: false })
    let handle
    try {
      handle = props.env.get<{ [id: Id]: Attachment }>("behaviors")
    } catch {
      return value
    }
    onCleanup(handle.subscribe((b) => setValue(() => b)))
    return value
  })

  const toggle = (id: Id) =>
    props.env.get<{ [id: Id]: Attachment }>("behaviors").change((b) => {
      b[id].on = !b[id].on
    })

  const url = () => {
    const id = current()
    return id ? behaviors()()[id]?.url : undefined
  }
  const [behavior] = createResource(url, async (u) => (await importBehavior(u)).default)
  const [source] = createResource(url, sourceOf)

  return (
    <div class="inspector">
      <div class="side">
        <div class="header">
          <button class="inspect" classList={{ active: props.inspecting }} onClick={props.onInspect} title="Inspect">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6">
              <rect x="3" y="3" width="11" height="11" rx="1" />
              <path d="M10 10 l7 3 -3 1 -1 3 z" fill="currentColor" />
            </svg>
          </button>
          <Breadcrumb env={props.env} onSelect={props.onSelect} />
        </div>

        <h3>Behaviors</h3>
        <ul class="behaviors">
          <For each={Object.entries(behaviors()())}>
            {([id, a]) => (
              <li classList={{ current: current() === id, off: !a.on }} onClick={() => setCurrent(id)}>
                <input type="checkbox" checked={a.on} onClick={(e) => e.stopPropagation()} onChange={() => toggle(id)} />
                <span class="title">
                  <BehaviorTitle url={a.url} />
                </span>
              </li>
            )}
          </For>
        </ul>

        <h3>State</h3>
        <State env={props.env} />
      </div>

      <div class="detail">
        <Show when={url()} fallback={<p class="hint">Select a behavior to see what it does and its source.</p>}>
          <Show when={behavior()}>
            {(b) => (
              <>
                <h2>{b().title}</h2>
                <p class="description">{b().description.trim()}</p>
              </>
            )}
          </Show>
          <Show when={source()}>
            {(s) => (
              <>
                <div class="file">{fileOf(url()!)}</div>
                <pre class="source">
                  <code>{s()}</code>
                </pre>
              </>
            )}
          </Show>
        </Show>
      </div>
    </div>
  )
}

/** The chain of registered environments from the root down to the shown one. */
function Breadcrumb(props: { env: Environment; onSelect: (env: Environment) => void }) {
  const chain = () => {
    const out: { env: Environment; label: string }[] = []
    for (let env: Environment | undefined = props.env; env; env = env.parent) {
      const r = registrationOf(env)
      if (r) out.unshift({ env, label: r.label })
    }
    return out
  }
  return (
    <div class="breadcrumb">
      <For each={chain()}>
        {(c, i) => (
          <>
            <Show when={i() > 0}>
              <span class="sep">›</span>
            </Show>
            <button classList={{ current: c.env === props.env }} onClick={() => props.onSelect(c.env)}>
              {c.label}
            </button>
          </>
        )}
      </For>
    </div>
  )
}

/** Every value visible in the environment, live, with where it comes from. */
function State(props: { env: Environment }) {
  const slots = createMemo<Accessor<SlotInfo[]>>(() => {
    const env = props.env
    const [list, setList] = createSignal<SlotInfo[]>([], { equals: false })
    let stops: (() => void)[] = []
    let scheduled = false
    const refresh = () => {
      scheduled = false
      for (const stop of stops) stop()
      const infos = describe(env)
      setList(infos)
      // Any change to any visible value, or a key appearing or going, refreshes the list.
      // `subscribe` calls back once right away; that call is not a change.
      subscribing = true
      stops = infos.map((s) => s.handle?.subscribe(schedule) ?? (() => {}))
      subscribing = false
    }
    let subscribing = false
    const schedule = () => {
      if (scheduled || subscribing) return
      scheduled = true
      queueMicrotask(refresh)
    }
    refresh()
    onCleanup(() => stops.forEach((stop) => stop()))
    return list
  })

  return (
    <table class="state">
      <tbody>
        <For each={slots()()}>
          {(s) => (
            <tr classList={{ inherited: !s.own, hidden: !s.handle }}>
              <td class="key">
                {s.key}
                <div class="origin">
                  {!s.handle ? "hidden" : s.declared ? "declared" : s.owner ? `put by ${s.owner}` : "put by the shell"}
                  {s.own ? "" : ", inherited"}
                </div>
              </td>
              <td class="value">{s.handle ? <Value value={s.handle.value} /> : "—"}</td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  )
}

/** A value on one line, truncated; click to see all of it. */
function Value(props: { value: unknown }) {
  const [open, setOpen] = createSignal(false)
  const compact = () => show(props.value)
  const long = () => compact().length > 60
  return (
    <span classList={{ expandable: long(), open: open() }} onClick={() => long() && setOpen(!open())}>
      {open() ? show(props.value, 2) : long() ? compact().slice(0, 60) + "…" : compact()}
    </span>
  )
}

function show(value: unknown, indent?: number): string {
  if (value instanceof Element) return `<${value.tagName.toLowerCase()}${value.className ? "." + value.className : ""}>`
  if (typeof value === "function") return "ƒ"
  try {
    return JSON.stringify(value, (_, v) => (v instanceof Element ? show(v) : v), indent) ?? String(value)
  } catch {
    return String(value)
  }
}

function BehaviorTitle(props: { url: string }) {
  const [behavior] = createResource(() => props.url, async (u) => (await importBehavior(u)).default)
  return <>{behavior()?.title ?? props.url}</>
}
