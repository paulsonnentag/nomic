// Which environment a DOM element belongs to. Whoever puts `dom` registers it,
// so that the shell can find the environment under the pointer.

import type { Environment } from "./runtime"

export type Registration = { env: Environment; label: string; bounds: () => DOMRect }

const byElement = new WeakMap<Element, Registration>()
const byEnv = new WeakMap<Environment, Element>()
const elements = new Set<Element>()

/**
 * Registers `el` as the element of `env`. `bounds` says how much of the page
 * the environment occupies; by default, the element's own box.
 */
export function register(el: Element, env: Environment, label: string, bounds = () => el.getBoundingClientRect()): () => void {
  byElement.set(el, { env, label, bounds })
  byEnv.set(env, el)
  elements.add(el)
  return () => {
    byElement.delete(el)
    byEnv.delete(env)
    elements.delete(el)
  }
}

export function registrationOf(env: Environment): Registration | undefined {
  const el = byEnv.get(env)
  return el ? byElement.get(el) : undefined
}

/**
 * The union of the SVG graphics inside `el`, padded. For an element that is
 * an overlay the size of its container and draws something smaller into it.
 */
export function graphicsBounds(el: Element, pad = 6): DOMRect {
  const graphics = el.querySelectorAll("rect, polyline, polygon, path, circle, ellipse, line, text")
  if (graphics.length === 0) return new DOMRect(0, 0, 0, 0)
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const g of graphics) {
    const r = g.getBoundingClientRect()
    left = Math.min(left, r.left); top = Math.min(top, r.top)
    right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom)
  }
  return new DOMRect(left - pad, top - pad, right - left + 2 * pad, bottom - top + 2 * pad)
}

/** The deepest registered element whose bounds are under the point. */
export function environmentAt(x: number, y: number, within: Element): { el: Element; rect: DOMRect } | undefined {
  let best: { el: Element; rect: DOMRect; depth: number } | undefined
  for (const el of elements) {
    if (!within.contains(el)) continue
    const rect = byElement.get(el)!.bounds()
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue
    let depth = 0
    for (let p = el.parentElement; p; p = p.parentElement) depth++
    if (!best || depth > best.depth) best = { el, rect, depth }
  }
  return best
}

export function lookup(el: Element): Registration | undefined {
  return byElement.get(el)
}
