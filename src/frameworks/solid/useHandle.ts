import { createSignal, onCleanup, type Accessor } from "solid-js"
import type { Handle } from "@/core/types"

/**
 * A signal that follows a handle. Values may be edited in place, so every
 * change counts as a new value.
 */
export function useHandle<T>(handle: Handle<T>): Accessor<T> {
  const [value, setValue] = createSignal<T>(handle.value, { equals: false })
  const stop = handle.subscribe((v) => setValue(() => v))
  onCleanup(stop)
  return value
}
