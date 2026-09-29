import { createResource, Show } from "solid-js"
import { render } from "solid-js/web"
import html from "solid-js/html"

/**
 * Puts at `dom` the source of a behavior's module at the heads it was mounted
 * from, read through the repo and highlighted with highlight.js, with line
 * numbers alongside. Says so when there is none: a behavior attached directly
 * has no package to read from. For behavior documents.
 */
export default function showSource(env) {
  if (env.read("data/@patchwork/type") !== "behavior") return
  const { fileText } = env.get("imports/core").value
  const { useHandle } = env.get("imports/solid").value
  const hljs = highlighter(env.get("imports/hljs").value.default, env.get("imports/hljs-javascript").value.default)
  const repo = env.get("repo").value
  const data = env.get("data")
  const dom = document.createElement("div")
  dom.className = "behavior-source"

  const dispose = render(() => {
    const b = useHandle(data)
    // Keyed by package and module, so other changes to the document do not refetch.
    const [source] = createResource(
      () => (b().package && b().module ? `${b().package} ${b().module}` : undefined),
      () => fileText(repo, b().package, b().module),
    )
    const code = () => hljs.highlight(source(), { language: "javascript" }).value
    const numbers = () => Array.from({ length: source().split("\n").length }, (_, i) => i + 1).join("\n")
    return html`
      <style>
        ${CSS}
      </style>
      <${Show} when=${() => !source.loading} fallback=${html`<div class="dim">loading…</div>`}>
        <${Show}
          when=${() => source() !== undefined}
          fallback=${html`<div class="dim">
            ${() => (source.error ? `⚠ ${source.error.message ?? source.error}` : "no source: not mounted from a package")}
          </div>`}
        >
          <div class="code">
            <pre class="numbers">${numbers}</pre>
            <pre class="text"><code class="hljs" innerHTML=${code}></code></pre>
          </div>
        <//>
      <//>
    `
  }, dom)
  env.put("dom", dom)
  return dispose
}

/** The highlight.js core with javascript registered; registering is idempotent, so every run may do it. */
function highlighter(hljs, javascript) {
  if (!hljs.getLanguage("javascript")) hljs.registerLanguage("javascript", javascript)
  return hljs
}

const CSS = `
.behavior-source { display: flex; flex-direction: column; height: 100%; min-width: 0; font: 12px/1.5 ui-monospace, Menlo, monospace; color: #24292e; }
.behavior-source .dim { color: #999; overflow-wrap: anywhere; }
.behavior-source .code { flex: 1; min-height: 0; display: flex; overflow: auto; border: 1px solid #eee; border-radius: 4px; background: #fafafa; }
.behavior-source pre { margin: 0; padding: 8px 0; white-space: pre; word-break: normal; tab-size: 2; font: inherit; }
.behavior-source .numbers { flex: none; position: sticky; left: 0; padding: 8px 10px 8px 12px; text-align: right; color: #bbb;
  background: #fafafa; border-right: 1px solid #eee; user-select: none; }
.behavior-source .text { flex: 1; padding: 8px 12px; }
.behavior-source .hljs-comment, .behavior-source .hljs-quote { color: #6a737d; font-style: italic; }
.behavior-source .hljs-keyword, .behavior-source .hljs-selector-tag, .behavior-source .hljs-subst { color: #d73a49; }
.behavior-source .hljs-number, .behavior-source .hljs-literal, .behavior-source .hljs-variable,
.behavior-source .hljs-template-variable, .behavior-source .hljs-tag .hljs-attr { color: #005cc5; }
.behavior-source .hljs-string, .behavior-source .hljs-doctag, .behavior-source .hljs-regexp { color: #032f62; }
.behavior-source .hljs-title, .behavior-source .hljs-section, .behavior-source .hljs-selector-id,
.behavior-source .hljs-title.function_ { color: #6f42c1; }
.behavior-source .hljs-type, .behavior-source .hljs-class .hljs-title, .behavior-source .hljs-title.class_ { color: #22863a; }
.behavior-source .hljs-attr, .behavior-source .hljs-attribute, .behavior-source .hljs-property { color: #005cc5; }
.behavior-source .hljs-built_in, .behavior-source .hljs-builtin-name { color: #e36209; }
.behavior-source .hljs-meta { color: #735c0f; }
.behavior-source .hljs-tag, .behavior-source .hljs-name { color: #22863a; }
.behavior-source .hljs-emphasis { font-style: italic; }
.behavior-source .hljs-strong { font-weight: bold; }
`
