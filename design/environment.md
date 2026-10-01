# Environment

The environment is the one piece of shared state between behaviors. It is a
tree of scopes: each scope holds named values, sees the values of the scopes
above it, and has behaviors attached to it that read those values and put new
ones. Behaviors never reference each other; they meet in the environment.

This spec covers the environment alone. How behaviors are found and loaded
(the loader and reconciler), how views are made (`View`), and how the tree is
served are separate, and only touch the environment through the interface
below.

## Concepts

**Handle.** A value with a change stream. Documents, fields of documents and
plain values all look like this; the environment stores handles and hands out
handles.

```ts
type Handle<T = unknown> = {
  readonly value: T
  /** What the handle points at: a document url, or a document url and a path for a field. Undefined for plain values. */
  readonly url?: string
  /** Mutate in place, or return the next value. */
  change(fn: (value: T) => T | void): void
  /** Calls `fn` now if there is a value, and on every change. Returns the unsubscribe. */
  subscribe(fn: (value: T) => void): () => void
}
```

**Key.** A path such as `data` or `data/@patchwork/type`. A binding at `data`
covers every key below it: `get("data/@patchwork/type")` walks into the value
bound at `data`, and `change` on it writes through. Binding a key drops the
bindings below it in the same scope, since they are no longer reachable.

**Binding.** A key bound in a scope. Several behaviors may bind the same key in
the same scope; every one of their values is kept as a candidate, and one is
visible: the chosen one, if any, else the last put. These are the _conflicts_
of the key. There are no defaults: the environment never creates a binding on
its own, and `get` on an unbound key is a handle with `undefined` in it until
someone puts something.

**Fork.** A child scope. It sees every binding above it and can shadow any of
them. Destroying a fork destroys its forks, detaches its behaviors and drops
its bindings.

**Id.** Every scope has an id derived from its parent's id and the name it
was forked under. The same tree built again gives the same ids, so an id can
be stored in a document and found again after a reload, a branch switch or a
view being rebuilt. The root's id is `root`.

**Behavior.** A function `(env) => teardown | void`, identified by the url it
was loaded from. Attaching it to a scope runs it there. It decides for itself
whether it applies: it reads what it needs and returns nothing if the scope is
not for it, or does its work and returns a teardown if it is. Every `.value`
read during the run is tracked; when any of them changes, the behavior is torn
down and run again, so one that did not apply can start to when the scope
changes. Every put a behavior makes is attributed to its url and dropped when
it is torn down.

**View.** A convention, not a type: a fork that shows a document. `View`
forks under the name `data.url`, puts `data`, the document's handle, and
`dom: null`; whichever behavior applies
puts an element at `dom`, and the view shows what is visible there. `dom` is
shadowed to `null` at birth because it is the one key a scope provides for
itself rather than for its children: without the shadow, a shape view would
see the canvas's element above it as its own.

## Interface

```ts
/** A behavior running in a scope, as `behaviors` describes it. */
type Behavior = {
  url: string
  /** What the last run returned: present when the behavior applies here. */
  teardown?: Teardown
  /** The keys read during the last run; their values are `get(key).value` here. */
  reads: Record<string, boolean>
  /** What the last run threw, if it did. */
  error?: string
}
type Teardown = () => void

/** One candidate at a key. `url` is undefined for puts made outside a behavior. */
type Conflict = { url: string | undefined; handle: Handle; chosen: boolean }

class Env {
  /** Stable across rebuilds: the parent's id and the fork's name. */
  readonly id: string
  readonly parent: Env | undefined
  readonly forks: readonly Env[]
  readonly behaviors: readonly Behavior[]

  // reading
  /** A live handle on what is visible at `key` from here: bound here, else inherited from above. */
  get<T = unknown>(key: string): Handle<T>
  /** The bindings made here, key → visible handle, in put order. Walk `parent` for the ones above. */
  entries(): Record<string, Handle>
  /** Every candidate at `key`, in put order, in the scope `get(key)` resolves to; empty if none. */
  conflicts(key: string): Conflict[]

  // writing
  /** Binds `key` here. A plain value is wrapped in a handle; a handle is stored as is. */
  put<T>(key: string, value: T | Handle<T>): Handle<T>
  /** Makes the candidate put by `url` at `key` the visible one; `undefined` goes back to the last put. */
  choose(key: string, url: string | undefined): void

  // behaviors
  /** Runs `run` here as the behavior at `url`, and again whenever what it read changes. Once per url per scope. */
  attach(run: (env: Env) => Teardown | void, url: string): void
  /** Tears the behavior at `url` down and drops its puts. */
  detach(url: string): void

  // structure
  /** A child scope with the id `<this id>/<name>`. */
  fork(name: string): Env
  destroy(): void
  /** Calls `fn` when the structure changes here, above or below: a put or drop, a choose, an attach or detach, a fork made or destroyed. */
  subscribe(fn: () => void): () => void

  // tooling
  /** The live scope with this id anywhere on the page; undefined while there is none. For the inspector, not for behaviors reaching into other views. */
  lookup(id: string): Env | undefined

  // storage
  #bindings: Map<string, { candidates: Map<string | undefined, Handle>; chosen?: string }>
  #behaviors: Map<string, { record: Behavior; stop: () => void }>
  #forks: Set<Env>
  #subscribers: Set<() => void>
  /** Every live scope on the page by id, shared by all of them. */
  static #scopes: Map<string, Env>
}
```

A behavior does not receive the scope itself but a facade over it with the
same interface. The facade knows the behavior's url, so its puts are
attributed, and it knows whether the behavior's run is on the stack, so the
`.value` reads it hands out during the run are tracked. Puts made through the
scope directly (by the site, or by `View`) have no url.

## Semantics

### Lookup

`get(key)` resolves to the nearest scope, starting here, that binds `key` or a
prefix of it; in that scope, the longest such key; the rest of the path is
walked into that binding's visible value. The handle is live: it always
reports what is visible now, and `change` goes to whatever is visible now.

`subscribe` on a live handle follows the visible candidate: it subscribes to
that handle's changes and to the structure of the scope, and when a put, drop
or choose changes which handle is visible, it moves its subscription and fires
with the new value. It fires only with defined values.

### Binding

`put(key, value)` in a scope:

1. Drops every binding in this scope strictly below `key`.
2. Adds `value` (wrapped if it is not a handle) as the caller's candidate at
   `key`, replacing the caller's previous candidate there. Candidates are kept
   in put order; re-putting moves the candidate to the end.
3. The visible candidate is the chosen one if it is still present, else the
   last. `choose(key, url)` picks one; it throws if nothing is bound at `key`
   here or `url` put nothing there.

Dropping a candidate (on detach or rerun) reveals the next one; dropping the
last removes the binding. `View`'s `dom: null` has no url and is never
dropped, so it is the floor a view falls back to when no behavior puts an
element.

### Tracking and rerun

While a behavior's run is on the stack, every `.value` read on a handle
obtained through its facade records the key. After the run, the behavior
follows each recorded key with `get(key).subscribe`; when a value differs from
the one recorded, a rerun is scheduled: once per microtask, the teardown is
called, the behavior's puts are dropped, and it is run again with fresh
tracking. Reads made inside callbacks and event handlers are not tracked, and
that holds for a `subscribe` callback even when it fires synchronously during
the run: `subscribe` calls back right away, and what that callback reads is
the callback's business, not the run's. A behavior follows those values by
subscribing, which it does anyway.

Values are compared by identity, so a handle whose `change` mutates in place
(a plain value's) does not rerun readers of the whole value, while a document
handle, which produces a new object per change, reruns anything that read the
whole document. The applies-check should therefore read the path it cares
about (`data/@patchwork/type`), not the document.

A behavior's own puts and drops never rerun it. More than a hundred reruns of
one behavior within a macrotask is a loop; it is reported on the console and
the behavior is left as it stands until the next change.

A run that throws is recorded in `error` and leaves the behavior with no
teardown; its puts up to the throw are dropped. Its reads are still followed,
so it is retried when they change.

### Attach and detach

`attach(run, url)` runs `run` here now and records a `Behavior`. Attaching a
url already attached here throws. Attaching to a destroyed scope is a no-op:
behaviors arrive asynchronously and the view that wanted them may be gone.

`detach(url)` calls the teardown, drops the behavior's puts, stops following
its reads and removes the record. Detaching an unknown url is a no-op.

`destroy()` destroys the forks first, then detaches the behaviors in reverse
attach order, then drops every binding, then removes itself from its parent
and from the id map.

### Ids and lookup

`fork(name)` gives the child the id `<parent id>/<name>` and registers it in
a map shared by every scope on the page. The name should say what the fork
is, not when it was made: `View` uses `data.url`, which is the document url
for a document and `<document url>/<path>` for a field, so a shape view's
name is stable across reloads, and, since the workspace's handles report the
original url, across branches too.

Forking a name already live under the same parent (the same document shown
twice in one view) suffixes it `~2`, `~3` in fork order. Those ids are stable
as long as the order is.

`lookup(id)` reads the map. When a view is rebuilt, its old scope is removed
from the map on destroy and the new one registered under the same id, so a
stored id finds whichever is live. A tool that holds an id follows
`subscribe` on the root and looks it up again on structure changes. `lookup`
returns the scope itself, not a facade: puts made through it are not
attributed, which is why it is for inspecting and not for behaviors.

### Notification

Structure changes are a put or drop, a choose, an attach or detach, a fork
made or destroyed. Each notifies the subscribers of the scope it happened in,
of every scope above it, and of every scope below it: not of siblings. So a
live handle at a shape view hears puts on the canvas view and the root through
the shape view alone, and a subscriber on the root hears everything.

Value changes (`handle.change`) are not structure changes. They reach live
handles through their subscription to the candidate and do not notify
`subscribe`.

### Identity

A behavior is identified by its url in the scope it is attached to. Since
urls are pinned to the tree they were served from, a code change gives a new
url; reloading is a detach of the old url and an attach of the new one, in
that order, in every scope. Puts carry the url of the behavior that made
them, so `conflicts` says which version of which behavior put what.

## Example

A canvas document is shown. `View` forks the root under the canvas's url (id
`root/automerge:<canvas>`), puts `data` (the canvas document) and
`dom: null`. Every behavior the root asked for attaches to the fork:

- `canvas/surface` reads `data/@patchwork/type`, sees `canvas`, applies: puts
  `dom` (a div), `surface/shapes` (the document's `shapes`, for the shape
  views), and for each shape renders a `View` of `field(data, "shapes", id)`.
- `canvas/pointer` reads `data/@patchwork/type` and `dom`. If it ran before
  the surface put its element, `dom` was `null` and it returned nothing; the
  put changes a value it read, so it reruns and now applies: it puts
  `surface/pointers` and writes pointer positions into it.
- `pen/pen` reads `data/tool`, sees `undefined`, returns nothing. It is not
  for this scope.

Each shape view is a fork of the canvas view with its own `data` and
`dom: null`. On the pen tool's shape, `pen/pen` reads `data/tool` and sees
`pen`, reads `surface/pointers` and finds the canvas's, and applies: it puts
`drawing: {}` and subscribes to the pointers. On a line shape, `pen/line` and
`pen/dots` both read `data/@patchwork/type`, see `line`, and both put `dom`;
the later one is visible, `conflicts("dom")` lists both, and `choose` can flip
them.

When the pen's code changes, the reconciler detaches the old url everywhere
(its `drawing` put goes with it) and attaches the new one. The canvas view,
the shape views and the documents are untouched.

## Not in this design

- No `read`: `get(key).value` during the run is the tracked read.
- No `own`: views shadow `dom` to `null` instead.
- No layers or import bindings: behaviors import code with `import`.
- No `inspect()`: `entries()`, `conflicts(key)`, `behaviors` and `forks`.
- No manifest or name for a behavior beyond its url.
