// Automerge urls: `automerge:<id>` names the live document, `automerge:<id>#<heads>` a pinned snapshot.

/** The url without its heads: the live document. */
export function headless(url) {
  return url.split("#")[0]
}

/** Whether `value` is an automerge url, pinned or not. */
export function isDocUrl(value) {
  return typeof value === "string" && /^automerge:[0-9A-Za-z]+(#[0-9A-Za-z|]+)?$/.test(value)
}

/** The pinned url of `handle` at its current heads. */
export function pinOf(handle) {
  return handle.view(handle.heads()).url
}

/** The path the service worker serves a pinned document under. */
export function basePath(pin) {
  return `/${encodeURIComponent(pin)}`
}

/** The text of a file document: a string, or an immutable string for artifacts. */
export function contentOf(fileDoc) {
  const c = fileDoc.content
  return typeof c === "string" ? c : (c?.val ?? String(c))
}

/** Splits `automerge:X/src/a.js` into its document url and module path (default `src/index.js`). */
export function splitTarget(target) {
  const slash = target.indexOf("/")
  if (slash < 0) return { url: target, path: "src/index.js" }
  const path = target.slice(slash + 1)
  return { url: target.slice(0, slash), path: path || "src/index.js" }
}
