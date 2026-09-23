import { createResource, createSignal, For, Show } from "solid-js"
import type { Attachment, Environment, Handle, Id, Record } from "./runtime"
import { fileOf, importBehavior, sourceOf } from "./behaviors"
import { useHandle } from "./solid"

/**
 * Shows one environment: its behaviors from the record, each with a switch,
 * and the description and source of the selected one.
 */
export function Inspector(props: { env: Environment; record: Handle<Record> }) {
  const behaviors = useHandle(props.env.get<{ [id: Id]: Attachment }>("behaviors"))
  const [current, setCurrent] = createSignal<Id | null>(null)

  const toggle = (id: Id) =>
    props.record.change((r) => {
      const b = (r.behaviors as { [id: Id]: Attachment })[id]
      b.on = !b.on
    })

  const url = () => {
    const id = current()
    return id ? behaviors()[id]?.url : undefined
  }
  const [behavior] = createResource(url, async (u) => (await importBehavior(u)).default)
  const [source] = createResource(url, sourceOf)

  return (
    <div class="inspector">
      <ul class="behaviors">
        <For each={Object.entries(behaviors())}>
          {([id, a]) => (
            <li classList={{ current: current() === id, off: !a.on }} onClick={() => setCurrent(id)}>
              <input
                type="checkbox"
                checked={a.on}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggle(id)}
              />
              <span class="title">
                <BehaviorTitle url={a.url} />
              </span>
            </li>
          )}
        </For>
      </ul>
      <div class="detail">
        <Show when={current()} fallback={<p class="hint">Select a behavior to see what it does and its source.</p>}>
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

function BehaviorTitle(props: { url: string }) {
  const [behavior] = createResource(() => props.url, async (u) => (await importBehavior(u)).default)
  return <>{behavior()?.title ?? props.url}</>
}
