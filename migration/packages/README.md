# `packages/` — cross-package shared modules

Workspace packages for **more than one consumer** (e.g. `client` + future `jobs`) or extractable repo boundaries.

**Present (copied for N2 shell):**

- `@gloaming/i18n` — locale messages + `t()`
- `@gloaming/shared` — contracts (auth policy used by nav/admin; other exports available as features migrate)

**`db` is not a package here.** Schema and migrations are inlined at `client/server/db/` (single consumer in the new tree). Do not create `migration/packages/db` without a second consumer.

Evolve other packages by copying/rewriting from monorepo root `packages/*` on demand — do not leave the client on permanent `file:` deps back to the root tree.

In-app UI↔server contracts that only this Next app needs live in `client/shared/` first; promote here when a second consumer appears.
