# nomic

A checkout of packages (`packages/`) hosted in Automerge through pushwork, a
site (`site/`) that boots them from the sync server, and a small CLI (`cli/`).

## Finishing work

Don't write smoke tests or end-to-end harnesses to verify changes. When a
change is ready:

1. `cd packages && node ../cli/main.ts install` if an importmap.json gained a
   checkout path (`"core": "/core"`).
2. `cd packages && pushwork sync` so the docs match the disk.
3. Tell the user what to test in the browser, concretely: which view to open,
   what to click, what they should see.

Unit checks of pure code (a quick Node script under `/tmp`, removed after) are
fine while working; the browser is the user's.

## Checkout

`packages/` is a pushwork checkout with the built-in `patchwork-folder` shape:
every directory is a folder doc, and a package is a folder holding a
`manifest.json`. The `pushwork` on the PATH must be the same version as
`node_modules/pushwork` — the CLI reads pushwork's store through its `dist/`.

## Checks

- `cd cli && npx tsc --noEmit -p tsconfig.json`
- `npx prettier --check .`
