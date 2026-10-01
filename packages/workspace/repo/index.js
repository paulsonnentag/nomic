// The workspace's branching repo. Each branch is a document mapping original
// urls to its copies; writes through the branch repo copy a document the first
// time and go to the copy after that. Puts `repo`, `branch` and `branches`.

export default function workspaceRepo(env) {
  if (env.get("data/@patchwork/type").value !== "workspace") return
  const base = env.parent?.get("repo").value // the page's repo; read above, so this scope's `repo` is not what is read
  const current = env.get("data/current").value
  const list = env.get("data/branches").value
  if (!base || typeof current !== "string" || !list) return
  const data = env.get("data")

  let cancelled = false
  ;(async () => {
    const handles = await Promise.all([...list].map((url) => base.find(url)))
    if (cancelled) return
    const branch = handles.find((h) => h.url === current)
    if (!branch) return
    const chain = await chainOf(base, branch) // this branch, then the ones it came from
    if (cancelled) return
    env.put("repo", branching(base, chain))
    env.put("branch", branch)
    env.put("branches", {
      list: handles.map((h) => ({ url: h.url, name: h.value?.name ?? "?" })),
      fork,
      switch: switchTo,
      merge,
    })
  })().catch((error) => console.error("[workspace/repo]", error))
  return () => {
    cancelled = true
  }

  function fork(name) {
    const next = base.create({ "@patchwork": { type: "branch" }, name, from: current, docs: {} })
    data.change((workspace) => {
      workspace.branches.push(next.url)
      workspace.current = next.url
    })
  }

  function switchTo(url) {
    data.change((workspace) => {
      workspace.current = url
    })
  }

  /** Merges this branch's copies into the branch it came from, and switches there. */
  async function merge() {
    const branch = await base.find(current)
    const { from, docs } = branch.value
    if (typeof from !== "string") return
    const chain = await chainOf(base, branch)
    for (const [original, copy] of Object.entries(docs ?? {})) {
      const target = mapped(chain.slice(1), original) ?? original
      const [into, source] = await Promise.all([base.find(target), base.find(copy)])
      base.merge(into, source)
    }
    data.change((workspace) => {
      const index = [...workspace.branches].indexOf(current)
      if (index >= 0) workspace.branches.splice(index, 1)
      workspace.current = from
    })
  }
}

/** The branch and its ancestors, nearest first. */
async function chainOf(base, branch) {
  const chain = [branch]
  for (let from = branch.value?.from; typeof from === "string";) {
    const parent = await base.find(from)
    chain.push(parent)
    from = parent.value?.from
  }
  return chain
}

/** The copy of `url` on the nearest branch in `chain` that has one. */
function mapped(chain, url) {
  for (const branch of chain) {
    const copy = branch.value?.docs?.[url]
    if (typeof copy === "string") return copy
  }
  return undefined
}

/**
 * A repo over `base` that reads through the branch chain and copies on write.
 * Handles keep the original url, so views fork under the same name on every
 * branch. On the root branch (no `from`) writes go to the originals.
 */
function branching(base, chain) {
  const [branch] = chain
  const isRoot = typeof branch.value?.from !== "string"
  const wrappers = new Map()
  return {
    branching: true,
    create: (init) => base.create(init),
    clone: (handle) => base.clone(handle),
    merge: (into, from) => base.merge(into, from),
    async find(url) {
      if (wrappers.has(url)) return wrappers.get(url)
      const original = await base.find(url)
      const copy = mapped(chain, url)
      const wrapper = shadow(original, copy ? await base.find(copy) : original)
      wrappers.set(url, wrapper)
      return wrapper
    },
  }

  function shadow(original, initial) {
    let current = initial
    const subscribers = new Set()
    let stop = current.subscribe((value) => subscribers.forEach((fn) => fn(value)))
    return {
      url: original.url,
      get value() {
        return current.value
      },
      change(fn) {
        if (!isRoot && typeof branch.value?.docs?.[original.url] !== "string") {
          const copy = base.clone(current)
          branch.change((b) => {
            b.docs[original.url] = copy.url
          })
          stop()
          current = copy
          stop = current.subscribe((value) => subscribers.forEach((fn) => fn(value)))
        }
        current.change(fn)
      },
      subscribe(fn) {
        subscribers.add(fn)
        fn(current.value)
        return () => subscribers.delete(fn)
      },
    }
  }
}
