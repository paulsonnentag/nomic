# Canvas example

This document sketches the behaviors for the demo: a workspace that shows a
canvas on a branch, a canvas with a pen, a select tool, an inspect tool and a
branch picker, and an inspector that shows the environment of a shape. Each
section lists what the document looks like, which behaviors handle it, what
each behavior reads and puts, and how the pieces fit. It builds on
[the environment design](./environment.md).

## Conventions

- Every document carries `@patchwork.type`. A behavior's first read is almost
  always `data/@patchwork/type`; it returns nothing if the type isn't its own.
- The document a view shows is always at `data`. There is no second name for
  it: a shape view's `data` is its shape, and the canvas's shapes are reached
  through `surface/shapes`.
- Each view has exactly one `dom`, put by the behavior that renders it. No
  behavior mounts into another behavior's element. A control that belongs on a
  view is a shape of its own.
- A slot is put by the behavior it belongs to. The exception is a slot that
  shape views write: it has to be put on the canvas view to be shared, and a
  put on a shape view is only visible inside that shape. Those slots are put
  by `canvas/surface`, which draws them.
- Shapes on a canvas are entries of `shapes`, keyed by id. Every shape carries
  `id` (the same string as its key), `x`, `y`, `z`, an `outline` (points
  relative to `x, y`; closed when the first point repeats at the end) and
  `@patchwork.type`. Whoever adds a shape writes the `id` in.
- Tools are ordinary shapes: type `tool`, a `tool` name, `locked: true`, and a
  random id like every other shape. A tool knows its own id from `data/id`.
- `tool` holds the id of the active tool shape, or `null`. A tool behavior is
  active when `env.get("tool").value === env.get("data/id").value`.
- Geometry (`contains`, `bounds`, `overlaps`) is a plain module,
  `canvas/geometry.js`, imported relatively by whoever needs it. There is no
  hit-testing slot.
- The canvas renderer draws selection and highlight traces itself. There is no
  overlay slot.
- `repo` is the minimal interface `{ create(init) → Handle, find(url) → Promise<Handle> }`.
  The site puts the real one on the root; the workspace shadows it.
- A behavior lives at `packages/<path>/index.js`. Shared code lives in files
  without an `index.js` and is imported relatively.

## Root

The site creates the root environment, puts `repo`, attaches the reconciler,
and renders `View({ env: root, data })`, where `data` is the document named by
the location hash. With an empty hash the site creates a workspace, a `main`
branch and a canvas seeded with the tool shapes and a branch picker, and sets
the hash.

| Slot   | Value                                   | Put by |
| ------ | --------------------------------------- | ------ |
| `repo` | `{ create, find }` over the page's repo | site   |

## Workspace document

Each branch is its own document. The workspace only points at them.

```json
{
  "@patchwork": { "type": "workspace" },
  "root": "automerge:<canvas>",
  "branches": ["automerge:<main>", "automerge:<try>"],
  "current": "automerge:<try>"
}
```

```json
{
  "@patchwork": { "type": "branch" },
  "name": "try-thicker-lines",
  "from": "automerge:<main>",
  "docs": { "automerge:<canvas>": "automerge:<clone>" }
}
```

`main` is a branch document with `docs: {}` and no `from`. A branch resolves a
url through its own `docs`, then its `from` branch's, and so on; a url with no
mapping is the original.

### Requirements

- Shadow `repo` so that `find` below the workspace returns the current
  branch's copy of the document.
- Copy on write: the returned handle reads from the original until its first
  `change`, which clones the original (`repo.clone`, so history is shared and
  merges are clean), records `docs[original] = clone` in the branch document,
  and forwards that change and all later ones to the clone.
- The returned handle reports the original's `url`. Anything that stores a url
  (an `embed` shape, the workspace's own `root`) stores the original, so the
  mapping stays keyed by originals and a merge doesn't rewrite references. It
  also keeps environment ids the same on every branch, since views are forked
  under their document's url.
- `create` passes through. A document created on a branch is referenced only
  from that branch's clones; when those merge, the reference comes along.
- Branch operations: fork the current branch (create a branch document with
  `from: current` and empty `docs`, append it to `branches`, set `current`),
  switch (set `current`), merge (for each `docs[original] = clone`, merge the
  clone into what `from` resolves `original` to; remove the branch from
  `branches`; set `current` to `from`).
- Branch documents and the workspace document are found through the parent's
  `repo`, never the shadowed one. They describe branches; they aren't on one.
- Expose the current branch and the branch operations to everything below.
- Render the root document through the shadowed repo. The workspace has no
  chrome of its own; branch controls are a shape on the canvas (see
  [Branch picker](#branch-picker)).

### Slots the workspace view provides

| Slot       | Value                                                                         | Put by           |
| ---------- | ----------------------------------------------------------------------------- | ---------------- |
| `repo`     | the branching repo: `find` resolves through the current branch, copy on write | `workspace/repo` |
| `branch`   | the current branch document handle                                            | `workspace/repo` |
| `branches` | `{ list: [{ url, name }], fork(name), switch(url), merge() }`                 | `workspace/repo` |
| `dom`      | the root document's view                                                      | `workspace/root` |

### Behaviors

| Behavior         | Applies when        | Reads                                                                                     | Puts                                 |
| ---------------- | ------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------ |
| `workspace/repo` | type is `workspace` | `repo` (the parent's), `data/current`, `data/branches`, the current branch's `from` chain | `repo`, `branch`, `branches`         |
| `workspace/root` | type is `workspace` | `repo`, `data/root`, `data/current`                                                       | `dom`, a `View` of the root document |

How it works:

- `workspace/repo` keeps a `Map<url, Handle>` of wrappers for the current
  branch. A wrapper's `value` and `subscribe` follow whichever handle is
  current (original or clone); its `change` clones on first use.
- Switching branch is a document edit: `data.change(d => d.current = url)`.
  `workspace/repo` and `workspace/root` both read `data/current`, so both
  rerun: a new `repo` and `branch` for the branch, then a new `View` of the
  root through them. The canvas view and everything under it is rebuilt on
  the branch's documents, under the same ids.
- `merge()` walks `docs`, merges each clone into the document the `from`
  branch resolves the url to, then removes the branch and switches to `from`.

## Canvas document

```json
{
  "@patchwork": { "type": "canvas" },
  "shapes": {
    "b7e1…": {
      "@patchwork": { "type": "tool" },
      "id": "b7e1…",
      "tool": "select",
      "locked": true,
      "x": 8,
      "y": 8,
      "z": 10,
      "outline": []
    },
    "0c42…": {
      "@patchwork": { "type": "tool" },
      "id": "0c42…",
      "tool": "pen",
      "locked": true,
      "x": 8,
      "y": 56,
      "z": 10,
      "outline": []
    },
    "9aa0…": {
      "@patchwork": { "type": "tool" },
      "id": "9aa0…",
      "tool": "inspect",
      "locked": true,
      "x": 8,
      "y": 104,
      "z": 10,
      "outline": []
    },
    "4d18…": {
      "@patchwork": { "type": "branch-picker" },
      "id": "4d18…",
      "locked": true,
      "x": 64,
      "y": 8,
      "z": 10,
      "outline": []
    },
    "f31d…": {
      "@patchwork": { "type": "line" },
      "id": "f31d…",
      "x": 120,
      "y": 80,
      "z": 0,
      "outline": [],
      "color": "#0a7"
    },
    "77c5…": {
      "@patchwork": { "type": "embed" },
      "id": "77c5…",
      "url": "automerge:<inspector>",
      "x": 300,
      "y": 40,
      "z": 1,
      "outline": []
    }
  }
}
```

### Requirements

- Show every shape at its position, stacked by `z`, each in its own view.
- Expose the shapes, the pointers and what is under each pointer as the
  surface.
- Keep `selection` and `highlights`, and draw both over the shapes.
- Keep the active `tool`. Pressing a tool's button makes it active.
- Select: press selects the shape under the pointer; press on nothing clears;
  dragging a selected shape moves every selected shape. When no tool is
  active, the select tool makes itself the active one.
- Pen: press and drag draws a line shape.
- Inspect: press creates an inspector document targeting the shape under the
  pointer and embeds it on the canvas.
- Embed: a shape that shows another document.

### Slots the canvas view provides

| Slot               | Value                                                                     | Put by           | Written by                           |
| ------------------ | ------------------------------------------------------------------------- | ---------------- | ------------------------------------ |
| `dom`              | the canvas element, shapes and traces in it                               | `canvas/surface` |                                      |
| `surface/shapes`   | `field(data, "shapes")`: the shapes, writable                             | `canvas/surface` | `pen/pen`, `canvas/select`, `canvas/delete`, `inspector/*` |
| `tool`             | active tool shape id, `null` at first                                     | `canvas/surface` | `tool`, `canvas/select`, `inspector/inspect` |
| `selection`        | shape id → `true`                                                         | `canvas/surface` | `canvas/select`, `canvas/delete`     |
| `highlights`       | key → `{ shape, color, dashed }`                                          | `canvas/surface` | `inspector/*`                        |
| `surface/pointers` | pointer id → `{ x, y, buttons }`                                          | `canvas/pointer` | `canvas/pointer`                     |
| `surface/hovering` | pointer id → `{ shape, env }`: the shape under it and its view's id       | `canvas/hover`   | `canvas/hover`                       |

`surface/shapes` is how a shape changes the shapes around it: a shape view's
`data` is only its own entry.

### Behaviors on the canvas view

| Behavior         | Applies when                                 | Reads                                                 | Puts / writes                                                                                                                                                       |
| ---------------- | -------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `canvas/surface` | type is `canvas`                             | `data`, `selection`, `highlights`                     | puts `dom`, `surface/shapes`, `tool`, `selection`, `highlights`; a `View` per shape, placed by `x, y, z`; traces selection and highlights over them                 |
| `canvas/pointer` | type is `canvas` and `dom` is an element     | `dom`                                                 | puts `surface/pointers` and keeps it in step with pointer events on `dom`                                                                                           |
| `canvas/hover`   | type is `canvas` and `surface/pointers` set  | `surface/pointers`, `surface/shapes`                  | puts `surface/hovering`: for each pointer, the topmost shape by `z` whose outline contains it, and the id of that shape's view (the fork whose `data/id` matches) |
| `canvas/delete`  | type is `canvas` and `selection` set         | `selection`, `surface/shapes`                         | removes the selected, unlocked shapes on Delete and clears `selection`                                                                                              |

### Behaviors on shape views

Each shape view is a fork of the canvas view named after its `data.url`, with
`data` = `field(data, "shapes", id)` and `dom: null`.

| Behavior            | Applies when                                              | Reads                                                                               | Puts / writes                                                                                                                                                                  |
| ------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tool`              | type is `tool` and `tool` set                             | `data/id`, `data/tool`, `tool`                                                      | puts `dom`, a button filled while `tool === data.id`; a press on the button writes `tool` = `data.id`                                                                         |
| `canvas/select`     | type is `tool`, tool is `select`, `surface/pointers` set  | `data/id`, `surface/pointers`, `surface/hovering`, `surface/shapes`, `tool`, `selection` | writes `tool` = its own id whenever `tool` is `null`; while active, selects on press and moves the selection on drag (see below)                                        |
| `pen/pen`           | type is `tool`, tool is `pen`, `surface/pointers` set     | `data/id`, `surface/pointers`, `surface/hovering`, `surface/shapes`, `tool`         | puts `drawing` (pointer id → line id); on a press adds a line shape with its `id` to `surface/shapes`, appends points while the button is held                                 |
| `pen/line`          | type is `line`                                            | `data`                                                                              | puts `dom`, a polyline                                                                                                                                                         |
| `pen/dots`          | type is `line`                                            | `data`                                                                              | puts `dom`, dots; a second candidate the inspector can choose                                                                                                                  |
| `inspector/inspect` | type is `tool`, tool is `inspect`, `surface/pointers` set | `data/id`, `surface/pointers`, `surface/hovering`, `surface/shapes`, `tool`, `repo` | previews via `highlights`; on a press on a shape, `repo.create` an inspector document targeting it, adds an `embed` shape for it, writes `tool` = `null`                       |
| `canvas/embed`      | type is `embed`                                           | `data/url`, `repo`                                                                  | puts `dom`, a `View` of the found document                                                                                                                                     |
| `workspace/picker`  | type is `branch-picker` and `branch` set                  | `branch`, `branches`                                                                | puts `dom`, the current branch's name with a menu to switch, fork and merge                                                                                                    |

Notes:

- There is no toolbar. The `tool` behavior owns its button, and the button
  makes its own shape active. Its element takes pointer events; the pointer
  still reaches `surface/pointers`, and the tools leave presses on locked
  shapes alone.
- Adding a tool is adding a shape with a new `tool` name and a behavior that
  applies to it; the button comes with the `tool` type.
- `canvas/select` owns the fallback: when the inspect tool lets go of `tool`,
  or a canvas starts with `tool: null`, the select tool claims it. No other
  behavior knows that select is the default.
- `canvas/embed` is why an inspector can be its own document: the shape holds
  position and the url; the document holds the inspector's state. Because
  `embed` finds through `repo`, the inspector document is branch-local under a
  workspace, like everything else.
- The `View` inside `canvas/embed` forks the embed shape's view, so the
  embedded document's behaviors see `surface/*`, `highlights` and `tool`
  through inheritance.

### Select and move

While the select tool is active, each pointer goes through press, drag and
release. What happens on each is decided by the shape under the pointer at
the press, from `surface/hovering`:

- **Press on an unlocked shape.** If it isn't selected, `selection` becomes
  just that shape. Either way, a move starts for this pointer: the press
  position and the `x, y` of every selected shape at that moment.
- **Press on nothing.** `selection` becomes `{}`. No move starts.
- **Press on a locked shape.** Ignored: it's a control.
- **Drag.** While the button is held, every shape in the move is set to its
  start plus the pointer's offset from the press, in one `surface/shapes`
  change per pointer update.
- **Release.** The move ends. Nothing else to write: the positions are
  already in the document.

The move is local state of the behavior, keyed by pointer id, not a slot:
nothing else needs to see it. Pressing a selected shape keeps the selection,
which is what lets you drag several shapes at once.

An embedded inspector's panel stops pointer events, so it is moved by its
frame: `canvas/embed` leaves a strip along the top of the shape that lets
presses through to the canvas.

## Branch picker

The picker is a shape of type `branch-picker` on the canvas. It is locked, so
the tools leave it alone, and its element stops pointer events so presses on
its menu stay with it. It reads `branch` for the name to show and `branches`
for the list and the operations; it knows nothing else about the workspace.

Outside a workspace nothing puts `branch`, so `workspace/picker` returns
nothing and the shape shows empty. The picker lives in the canvas document, so
it is on the branch like every other shape; that is harmless, since it holds
no state.

## Inspector document

```json
{
  "@patchwork": { "type": "inspector" },
  "target": {
    "shape": "f31d…",
    "env": "root/automerge:<workspace>/automerge:<canvas>/automerge:<canvas>/shapes/f31d…"
  },
  "color": "#4a8cf7",
  "environment": 2,
  "behavior": "/<pin>/pen/pen/index.js",
  "picking": false
}
```

`target.env` is the id of the target's view; `target.shape` is its shape id,
for the highlight and to notice when the shape is deleted. `environment` is
the depth of the selected scope in the chain; `behavior` the url of the
selected behavior in it. `picking` says the next press of the inspect tool
retargets this inspector instead of creating one.

### Requirements

- Show the chain of environments from the root to the target's view. For
  each: its `entries()` with the visible value and, per key, its `conflicts`
  with who put each candidate; its `behaviors` with whether each applies
  (`teardown` present), what it read (`reads`, valued through `get`), and its
  error if any.
- Let the user select an environment in the chain and a behavior in it; let
  them `choose` among conflicts.
- Outline the target on the canvas through `highlights` in the inspector's
  color.
- Close when the target shape is deleted.

### Behaviors

| Behavior           | Applies when                             | Reads                                                            | Puts / writes                                                                        |
| ------------------ | ---------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `inspector/panel`  | type is `inspector`                      | `data`                                                           | puts `dom`; renders the chain of `lookup(target.env)`, entries with conflicts, behaviors; `choose` on click |
| `inspector/target` | type is `inspector` and `highlights` set | `data/target`, `data/color`, `highlights`, `surface/shapes`      | writes `highlights[data.url]`; removes the embed shape when `target.shape` is gone from `surface/shapes` |

The panel stops pointer events at its element so the canvas tools never see
presses on it. It subscribes to the root environment to re-render on
structure changes, and to each shown handle for value changes.

### From a shape to its environment

Every environment has an id that is the same each time the tree is built
(see [Ids and lookup](./environment.md#ids-and-lookup)), and `lookup(id)`
finds the live one:

1. `canvas/hover` puts, for each pointer, the hovered shape and the id of its
   view. It gets the id from its own `forks`: the one whose `data/id` is the
   shape.
2. The inspect tool writes that id into the new inspector document as
   `target.env`.
3. The panel calls `env.lookup(target.env)` and shows that scope and its
   parents, reversed: root, workspace view, canvas view, shape view.
4. On a reload, a branch switch or a view being rebuilt, the scope is
   recreated under the same id. The panel follows the root's `subscribe` and
   looks the id up again, so it moves to the new scope, and shows nothing in
   between.

The canvas view and the root are in every shape's chain, so they're
inspected by selecting their depth rather than by a target of their own.

`lookup` is for the inspector. A behavior that reached other views through it
would depend on the tree's shape and put unattributed values; behaviors meet
through the slots they inherit instead.

## Splitting

The split follows one rule: a behavior owns one slot or one interaction. It
gives you these seams:

- Replace the renderer of a shape type by adding a behavior that puts `dom`
  for that type (`pen/dots` next to `pen/line`).
- Replace the pointer source without touching tools; `canvas/pointer` is the
  only behavior that listens to the canvas element.
- Add a tool by adding a shape with a new `tool` name and a behavior for it.
- Add a control by adding a shape type and a behavior that renders it, like
  the branch picker.
- Put the whole canvas on a branch without any canvas behavior knowing: the
  workspace shadows `repo`, and everything that finds or creates documents
  does so through the environment.

What the split doesn't give you is a canvas without `canvas/surface`: it
renders the shapes and puts the slots they share.

## Not in this design

- No marquee: press selects one shape. Drag-to-select is one slot and one
  behavior away.
- No hit-testing slot: geometry is a module.
- No overlay slot and no extension elements: each view has one `dom`.
- No second name for a view's document: it is always `data`.
- No special tool ids: tools are shapes.
- No toolbar and no central state behavior: each slot is put by the behavior
  it belongs to, or by the surface when shape views share it.
- No map of shape views: `lookup` by id finds any environment.
- No inspector target for the canvas itself: it is in every shape's chain.
