# nomic

A checkout of packages (`packages/`) hosted in Automerge through pushwork, a
site (`site/`) that boots them from the sync server, a small CLI (`cli/`), and
nomic's fork of pushwork (`pushwork/`, see its AGENTS.md).

## Finishing work

Don't write smoke tests or end-to-end harnesses to verify changes. When a
change is ready:

1. `cd packages && node ../cli/main.ts install` if an importmap.json gained a
   checkout path (`"core": "/core"`).
2. `cd packages && node ../cli/main.ts sync` so the docs match the disk.
3. Tell the user what to test in the browser, concretely: which view to open,
   what to click, what they should see.

Unit checks of pure code (a quick Node script under `/tmp`, removed after) are
fine while working; the browser is the user's.

## Checkout

`packages/` is a pushwork checkout with the `patchwork-folder` shape: every
directory is a folder doc, and a package is a folder holding a
`manifest.json`. Every link carries heads, so a pinned url names exact content
down to the files, and a sync that changes a file moves the root's heads. Only
use `nomic sync`/`nomic init` (the fork), never another pushwork: the
published one writes headless links.

## Checks

- `cd cli && npx tsc --noEmit -p tsconfig.json`
- `npx prettier --check .`
- `yarn workspace pushwork typecheck` after changing the fork
