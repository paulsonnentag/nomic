# Nomic

Nomic is an experimental programming environment. It has two goals:

- Every effect is inspectable. You can always see what acts on what, and
  which behavior put it there.
- Systems grow by attaching things, not by editing them.

A system is an *environment* with *behaviors* attached to it. The
environment holds named values. Each behavior is a small function that reads
some of those values and writes others. Attach a behavior and the system
gains an ability. Detach it and the ability is gone, along with everything
it wrote.

Nomic is a revision of [Cards](https://github.com/paulsonnentag/cards). It keeps the
model of scoped, attributed, live values and drops boards, views,
documents, and stacked stickers.

## Concepts

Nomic has three concepts: environments, behaviors, and records.

An **environment** is a scoped set of named values. You create a root
environment and fork children from it. A child reads every value that its
parent has, live. A child can shadow a value by putting its own under the
same key, and it can hide a value so that the key reads as nothing for it
and its children. Each key has one slot per environment.

A **behavior** is a module whose default export is an object with a title, a
description, and a `mount` function. While a behavior is attached to an
environment, it has an effect on that environment: it reads values,
subscribes to them, and puts values of its own. When you detach the
behavior, its values are dropped and its effect ends. Behaviors are
granular. *Drag shapes*, *Select shapes*, and *Resize shapes* are three
behaviors, not one. A behavior's description is Markdown that says what the
behavior does, for a person and for a model that might write or edit it.

A **record** is the serialized form of an environment: a JSON object whose
fields are the environment's declared values. One field, `behaviors`, lists
the behaviors to attach and whether each one is on. Loading a record into an
environment makes the record's fields *be* the environment's values, so that
changing a value changes the record. A field of a record can itself be a
record. That is how environments nest.

## Terms

This document uses one name for each concept. The following table defines
the names.

| Term | Meaning |
|---|---|
| environment | A scoped set of named values, with behaviors attached. |
| key | The name of a value in an environment. |
| value | What is stored at a key. Any JavaScript value at runtime; JSON in a record. |
| handle | A live reference to a value. `get` returns a handle. |
| put | The verb that sets a value in an environment's own slot. |
| change | The verb that edits a value where it lives. |
| hide | The verb that makes a key read as nothing in an environment and its children. |
| fork | A child environment. It reads its parent's values live. |
| behavior | An object with a title, a description, and a `mount` function. A behavior module's default export. |
| attach | To mount a behavior on an environment. The behavior's puts land on the environment, attributed to it. |
| detach | To unmount a behavior. Its values are dropped and its teardown runs. |
| hand | The fork that the runtime makes for one behavior. It is invisible to the behavior. |
| record | A JSON object that describes an environment: its declared values and its behaviors. |
| load | To hydrate an environment from a record and follow the record from then on. |
| declared value | A value that a record names. It persists. |
| runtime value | A value that a behavior put. It is dropped on detach and never serialized. |
| input | A runtime value written from outside the system, such as `pointer`. |

## How it works

This section describes environments, reading and writing, behaviors,
records, inputs, the inspector, and persistence.

### Environments and forks

An environment holds values in slots, one slot per key. `createEnvironment()`
creates a root. `fork()` creates a child. The child starts with no slots of
its own and reads every value that its parent has.

Resolution at a key goes up the fork chain. The environment's own slot wins.
If it has none, the parent's slot is consulted, and so on to the root. A
hide is a slot without a value, and it ends the search: the key reads as
nothing in the environment that hid it and in every environment below.

A value that you put in a child is visible to the child and its forks. It is
not visible to the parent or to the parent's other forks. Anything that you
didn't put, you read from the parent, live. When the parent's value changes,
yours changes. An environment can't look up. It has a `parent` to ask, but
no key names it.

This is what makes an environment the thing that you hand to a behavior.
Fork an environment, put what the behavior should see, hide what it
shouldn't, and attach the behavior to the fork. The behavior can't tell a
`dom` that was put for it from one that the page provides, and it can't
reach anything that you didn't give it.

### Reading

`get` returns a handle to the value that is visible at a key:

```ts
const shapes = env.get<Record<Id, Shape>>("shapes")
shapes.value                       // the current value
shapes.subscribe((s) => { … })     // now, and after every change
```

If nothing is visible at the key, `get` throws `NotFound`. There is no lazy
handle and no promise to await. This gives you an ordering rule: behaviors
attach in record order, and the values that a behavior puts synchronously
in `mount` are visible to the behaviors after it. A parent puts `dom`
before it loads a child. If a behavior needs a value that isn't there, the
record is wrong, and `mount` fails loudly.

`get(key, default)` reads like `get(key)` with one addition. If nothing is
visible at the key, the environment puts `default` before reading. The
default is a runtime value attributed to the calling behavior. It is
dropped when the behavior detaches. Because a default is a put, it shadows
a value that the parent puts later at the same key, and it is missing from
any record. Use a default for a value that is private to the behavior.
Declare shared values in the record.

`entries()` returns every key that is visible in the environment, own and
inherited, with a handle to each. It doesn't include hidden keys. Use
`parent.entries()` to tell inherited keys from own ones.

### Writing

Changing a thing and replacing it are different operations, and the API
keeps them apart:

```ts
env.put(key, value)         // set the environment's own slot; attributed to the caller
handle.change(fn)           // edit the value where it lives
env.hide(key)               // a slot without a value; the key reads as nothing here and below
```

**`put`** sets the environment's own slot at the key. The slot is
attributed to the behavior that made the put, and it is cleared when that
behavior detaches. A behavior that puts twice at one key replaces its own
value. Two behaviors that put at one key share the slot, and the last write
wins. There is no stack: when the behavior that holds the slot detaches, the
slot is empty, and an earlier value that another behavior wrote is not
restored. `put` at a key that the environment's record declares throws.
Declared values are changed, not replaced.

**`change`** edits the value where it lives. It goes *through*. When a child
changes an inherited record, it changes the parent's value, and every
reader sees the change. When a behavior changes a declared value, it
changes the record. A change has no attribution and is not dropped on
detach. It is a real edit, and it stays. `fn` receives the value and can
edit it in place. If `fn` returns a value, that value replaces the old one
where it lives. This is how you change a primitive:

```ts
selected.change(() => "abc")                    // a declared string; the record's field is now "abc"
shapes.change((s) => { s.abc.x += dx })         // a declared object, edited in place
```

**`hide`** puts a slot without a value. Readers at the key get `NotFound` in
the hiding environment and in every environment below it. A hide is
attributed and dropped like any put. To get a value back, put over the
hide.

Rule of thumb: *to share, change a declared value; to scope, put your own.*
A behavior that wants to move a shape changes `shapes`. A behavior that
wants a private list of hit boxes puts `hits`.

### Behaviors

A behavior is an object with a title, a description, and a `mount`
function. A behavior module exports it as the default export:

```ts
export default {
  title: "Drag shapes",
  description: "Moves the selected shape while the pointer button is held.",
  mount(env: Environment) {
    …
    return () => { … }         // optional teardown; your values are dropped for you
  },
} satisfies Behavior
```

To attach a behavior, call `attach`:

```ts
const detach = env.attach(drag)     // forks a hand, calls drag.mount(hand)
…
detach()                            // drops the behavior's values, runs its teardown
```

`attach` forks the environment into a **hand** for the behavior and calls
`mount` with it. A hand is a fork with no slots of its own. It reads
exactly what the environment reads. It differs from a child in one way:
what the behavior puts or hides through its hand lands on the environment,
attributed to the behavior. The environment, the other behaviors on it, and
its forks all read it. Detaching clears every slot that the behavior holds
and then runs its teardown function, if it returned one. A behavior that
only puts needs no teardown. A behavior that holds something that isn't a
value, such as a DOM element, a timer, or a library instance, releases it in
the teardown.

`mount` may return a promise. `attach` doesn't await it. The ordering
guarantee covers the puts that `mount` makes before it first yields.

Behaviors have no settings. Anything that differs between two attachments
of one behavior is a value in the environment. A *Rectangle* behavior reads
`color` from its environment; it isn't given one. If two attachments of one
behavior in one environment ever need to differ, they belong in two
environments.

### Records and loading

A record is the serialized form of an environment. It is a JSON object.
Each field is a declared value. The field `behaviors` is reserved, and
lists the behaviors to attach:

```ts
type Record = { [key: Key]: Json }         // behaviors: Record<Id, { url: string; on: boolean }>
```

```json
{
  "behaviors": {
    "pointer": { "url": "behavior:pointer", "on": true },
    "canvas":  { "url": "behavior:canvas",  "on": true },
    "select":  { "url": "behavior:select",  "on": true },
    "drag":    { "url": "behavior:drag",    "on": true }
  },
  "tool": "pen",
  "selected": null,
  "shapes": {}
}
```

`load(record)` hydrates the environment from a handle to a record:

1. Each field of the record becomes the environment's own value at that
   key. The value *is* the record's field. A `change` through the handle
   edits the record, and a change to the record is visible through the
   handle.
2. Each entry of the environment's own `behaviors` that is `on` is loaded by
   URL and attached, in the order the entries appear.
3. From then on, the environment follows the record. A behavior switched on
   attaches; one switched off detaches; a field added is put; a field
   removed is dropped.

The runtime follows an environment's *own* `behaviors` value, never an
inherited one. Otherwise a fork would attach its parent's behaviors again.

A field of a record can be a record. Nothing marks it. It becomes an
environment when a behavior forks and loads it:

```ts
// In the Canvas behavior. `shapes` is Record<Id, Record>.
const child = env.fork()
child.put("dom", element)
child.load(field(shapes, id))
```

The child's declared `x` and the parent's `shapes.abc.x` are one field of
one record. A change through either notifies both. This is what lets a
*Drag* behavior on the canvas and a *Rectangle* behavior on the shape agree
without either knowing that the other exists.

The runtime is a tree of environments. The root record describes the whole
tree, because each child's record is a field of its parent's. Everything a
behavior puts is runtime state and is gone when the record is loaded again.
Everything a behavior changes in a declared value is kept.

### Input is a value

Behaviors don't register DOM event handlers. Whatever comes from outside the
system enters as a put to a key, made by one behavior whose job that is.
Every other behavior subscribes to the key.

```ts
// The Pointer behavior, the only one that listens to the DOM
mount(env: Environment) {
  const dom = env.get<HTMLElement>("dom").value
  const write = (e: PointerEvent) =>
    env.put("pointer", { x: e.offsetX, y: e.offsetY, buttons: e.buttons })
  dom.addEventListener("pointerdown", write)
  dom.addEventListener("pointermove", write)
  dom.addEventListener("pointerup", write)
  return () => { … }
}

// Any other behavior
env.get<Pointer>("pointer").subscribe((p) => { … })
```

`pointer` is a value, so a slow subscriber sees the latest state, not every
intermediate one. A behavior that needs every sample, such as a pen, keeps
the stroke in progress itself and appends on each change it sees.

### The inspector

The inspector shows one environment. It lists the environment's behaviors,
from its `behaviors` value, each with a switch. Switching a behavior off
changes the record, `load` detaches it, and its effect stops. Selecting a
behavior shows its description.

There is no separate view of values. The environment is plumbing; the
behaviors are what you look at. The shell finds the environment for a DOM
node through a registry that whoever puts `dom` maintains.

### Persistence

The record is the serialization. The environment is never serialized.

```ts
const record = wrap<Record>(JSON.parse(localStorage.getItem("canvas") ?? seed))
record.subscribe((r) => localStorage.setItem("canvas", JSON.stringify(r)))

const root = createEnvironment({ import: (url) => modules[url]() })
root.put("dom", page)
root.fork().load(record)
```

Every `change` to a declared value, at any depth, is a change to `record`,
so the subscription above is the whole persistence story. Nested
environments persist by containment. Runtime values are recreated by
attaching behaviors again.

## API reference

The following declarations describe the API. `Json` is the usual recursive
JSON type.

```ts
// ---- keys and handles --------------------------------------------------------

type Key = string
type Id = string

type Handle<T> = {
  readonly value: T                                   // throws NotFound if nothing is there
  change(fn: (value: T) => T | void): void            // edit in place, or return a replacement
  subscribe(fn: (value: T) => void): () => void       // calls fn now, and after every change
}

// ---- environments ------------------------------------------------------------

type Environment = {
  readonly parent: Environment | undefined

  get<T>(key: Key, default?: T): Handle<T>            // visible value; with a default: puts it if nothing is there; else throws NotFound
  put(key: Key, value: unknown): void                 // own slot, attributed to the caller; throws on a declared key
  hide(key: Key): void                                // a slot without a value
  entries(): { [key: Key]: Handle<unknown> }          // every visible key, own and inherited

  attach(behavior: Behavior): () => void              // fork a hand, call mount; returns detach
  load(record: Handle<Record>): void                  // hydrate declared values, attach behaviors, follow the record
  fork(): Environment
  close(): void                                       // detach behaviors, close forks
}

function createEnvironment(options?: {
  import?(url: string): Promise<{ default: Behavior }>   // how load resolves a behavior URL; the platform's import() by default
}): Environment

// ---- behaviors ---------------------------------------------------------------

type Behavior = {
  title: string
  description: string                                 // Markdown
  mount(environment: Environment): Teardown | void | Promise<Teardown | void>
}
type Teardown = () => void

// ---- records -----------------------------------------------------------------

type Record = { [key: Key]: Json }                    // behaviors: Record<Id, Attachment> is reserved
type Attachment = { url: string; on: boolean }

// ---- helpers -----------------------------------------------------------------

function wrap<T>(value: T): Handle<T>                                     // a handle over a plain value
function field<T>(handle: Handle<unknown>, ...keys: string[]): Handle<T>  // a handle into a value; change writes through

class NotFound extends Error { readonly key: string }
```

## Rules

The following rules summarize the semantics.

1. **One slot per key per environment.** Resolution takes the environment's
   own slot, then the parent's, up to the root. A hide ends the search.
2. **`get` throws.** If nothing is visible at the key, `get` throws
   `NotFound`. Behaviors attach in record order, and a behavior sees the
   synchronous puts of the behaviors before it.
3. **`put` replaces.** A put sets the environment's own slot. A behavior
   that re-puts replaces its own value. Two behaviors share the slot, and
   the last write wins. A put at a declared key throws.
4. **`change` goes through, and stays.** It edits the value where it lives:
   the parent's slot, or the record's field. It has no attribution and is
   not dropped on detach. A returned value replaces the old one.
5. **`hide` is a slot without a value.** It applies to the hiding
   environment and below. It is attributed and dropped like a put.
6. **A default is a put.** `get` with a default puts the default if nothing
   is there, attributed to the caller. Declare shared values in the record
   instead.
7. **Every put has an attribution.** The runtime knows which behavior holds
   each slot. Detaching a behavior clears its slots and runs its teardown.
   Closing an environment detaches its behaviors and closes its forks,
   innermost first.
8. **Live means live.** A handle reports the current value, and its
   subscribers hear every change, including a change through another handle
   to the same value.
9. **A behavior writes to its environment.** `attach` forks a hand that
   reads what the environment reads and writes onto the environment. The
   environment and everything below it see the behavior's effects.
10. **The record describes; the environment is.** `load` makes the record's
    fields the environment's declared values and follows the record. A
    declared value persists through `change`. A runtime value is never
    written back.
11. **Behaviors come from the record's own `behaviors`.** The runtime never
    follows an inherited `behaviors` value.
12. **Input is a value.** Everything from outside the system enters as a put
    to a key by one behavior. Every other behavior subscribes to it.

## Accepted trade-offs

The design accepts the following trade-offs:

- One slot per key. Two behaviors that put the same key overwrite each
  other, and detaching the winner leaves the slot empty. Contributors to
  one thing put under distinct keys, or change one declared value.
- `change` is not dropped on detach. A declared value that a behavior
  edited stays edited after the behavior detaches.
- `get` throws. A behavior can't wait for a value that a later behavior
  will put. Order the record so that producers come before consumers.
- A default is a put, so it shadows a parent's later value and is missing
  from records. Declare anything shared.
- Inputs are values, so a slow subscriber can miss intermediate states. A
  behavior that needs every sample accumulates them itself.
- A behavior's values land on the environment it is attached to, not on its
  hand. A behavior can't keep a value private to itself; it forks for that.
- Whoever holds the root can close anything below it. The defense is to not
  hand out the root.
- Behaviors are modules that `import()` can load. Running a behavior stored
  in a record needs a loader, which is `createEnvironment`'s `import`
  option.
- Records are plain JSON. There is no merge, no sync between tabs, and no
  way for two environments to refer to one thing. See *Documents* below.

## Not yet designed

The following topics are deferred:

- **Documents.** Records as Automerge documents, so that they sync and
  merge. The rule to add is that a string value with a URL scheme is a
  link, `field` crosses it, and `load` accepts a URL. `selected` would hold
  a URL instead of an id. Nothing in a behavior changes.
- **Attribution queries.** The runtime knows which behavior holds each slot
  and which keys each behavior has read. A `writes(environment, id)` and
  `reads(environment, id)` for the inspector's behavior page.
- **Live `entries`.** `entries()` is a snapshot. The inspector re-queries it
  when `behaviors` changes. A live form may be wanted later.
- **Isolation.** A fork that inherits nothing, for a behavior that shouldn't
  see its parent's values.
