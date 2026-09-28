import { createResource, Show } from "solid-js"
import { render } from "solid-js/web"
import html from "solid-js/html"

/**
 * Puts at `dom` a card for a behavior document: its name, where it came from
 * (package and module), and the source of its module at the pin it was mounted
 * from, read through the repo.
 */
export default function showBehavior(env) {
  const { fileText } = env.get("imports/core").value
  const { useHandle } = env.get("imports/solid").value
  const repo = env.get("repo").value
  const data = env.get("data")
  const dom = document.createElement("div")
  dom.className = "behavior"

  const dispose = render(() => {
    const b = useHandle(data)
    // Keyed by pin and module, so other changes to the document do not refetch.
    const [source] = createResource(
      () => (b().pin && b().module ? `${b().pin} ${b().module}` : undefined),
      () => fileText(repo, b().pin, b().module),
    )
    return html`
      <style>
        ${CSS}
      </style>
      <h2>${() => b().name}</h2>
      <div class="dim">${() => b().package ?? "attached directly"}${() => (b().module ? ` · ${b().module}` : "")}</div>
      <${Show} when=${() => b().pin}><div class="dim">${() => b().by}</div><//>
      <${Show} when=${() => !source.loading} fallback=${html`<div class="dim">loading…</div>`}>
        <${Show}
          when=${() => source() !== undefined}
          fallback=${html`<div class="dim">
            ${() => (source.error ? `⚠ ${source.error.message ?? source.error}` : "no source: not mounted from a package")}
          </div>`}
        >
          <pre>${source}</pre>
        <//>
      <//>
    `
  }, dom)
  env.put("dom", dom)
  return dispose
}

const CSS = `
.behavior { display: flex; flex-direction: column; height: 100%; min-width: 0; font: 12px/1.5 ui-monospace, Menlo, monospace; color: #222; }
.behavior h2 { margin: 0 0 4px; font-size: 13px; }
.behavior .dim { color: #999; overflow-wrap: anywhere; }
.behavior pre { flex: 1; max-height: none; margin: 6px 0 0; padding: 8px; overflow: auto; white-space: pre; word-break: normal;
  background: #f6f6f6; tab-size: 2; }
`
