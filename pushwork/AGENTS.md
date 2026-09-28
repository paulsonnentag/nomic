# pushwork (nomic's fork)

Bidirectional directory synchronization using Automerge CRDTs. This is a fork
of [inkandswitch/pushwork](https://github.com/inkandswitch/pushwork), branch
`pin-all-links`, vendored into nomic with `git subtree` (prefix `pushwork/`).
It differs from the published package in that every file and folder link in a
folder doc is heads-pinned, so a pinned url names exact content all the way
down.

It is a yarn workspace of nomic, not a pnpm project: dependencies come from
the root `yarn install`, and `yarn workspace pushwork build` (run by the root
`prepare`) compiles `src/` to `dist/` with `tsc`. The nomic CLI imports it as
`pushwork`; `nomic sync` and `nomic init` call its functions. There are no
changesets and nothing is published from here.

Pulling upstream changes:

```
git subtree pull --prefix=pushwork git@github.com:inkandswitch/pushwork.git <branch>
```

## checks

```
yarn workspace pushwork test
yarn workspace pushwork typecheck
```
