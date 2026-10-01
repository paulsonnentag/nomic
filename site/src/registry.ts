// Where a behavior url can be imported from. Kept apart from the loader so it
// survives the loader being replaced by hot reloading: the reconciler holds
// this module, the loader fills it.

import type { Run } from "./environment.js"

export type Module = { default: Run }

const loaders = new Map<string, () => Promise<unknown>>()

/** Says how to import the behavior at `url`. */
export function register(url: string, load: () => Promise<unknown>): void {
  loaders.set(url, load)
}

/** Imports the behavior at `url`: a registered loader, else the url itself. */
export async function load(url: string): Promise<Module> {
  const loader = loaders.get(url)
  const module = (await (loader ? loader() : import(/* @vite-ignore */ url))) as Partial<Module>
  if (typeof module.default !== "function") throw new Error(`${url} does not export a behavior as default`)
  return module as Module
}
