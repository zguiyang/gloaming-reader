# Shared contracts and i18n

**Live product (repo root):** contracts live in `shared/` (import
`@/shared/<module>`); locale messages and `t()` live in `i18n/` (`@/i18n`).
Database schema and migrations live in `server/db` (not a workspace package).
This repository is a **single pnpm package** — not a multi-package monorepo.

Legacy `@gloaming/shared` / `@gloaming/i18n` / `@gloaming/db` sources remain
under `archive/packages/` for the old three-app stack only.

Identify the owning module and public entry from definitions, declared exports,
consumers, and accepted decisions. Apply [architecture rules](architecture.md)
when changing boundaries.

## Ownership

- Shared application contracts have one authoritative owner. Import or derive
  controlled values, validation policy, types, and pure functions from that
  owner; do not maintain competing application-local definitions.
- A symbol belongs to the module defining its semantic contract, not the feature
  or directory consuming it. Mixed-domain imports stay separated by owner;
  co-use does not justify merging modules.
- `shared/` owns UI ↔ server contracts and pure policy, not ORM, secrets,
  application workflows, or backend runtime policy. `server/db` owns database
  schema and migrations. Shared modules must not depend on `server/`,
  `features/`, or React UI. A single deploy unit does not move schema into
  Shared, move runtime policy into Shared, or dissolve these ownership
  boundaries.

## Public API and compatibility

- Shared uses semantic module subfolders with explicit `index.ts` entries and has
  no root facade. Consumers import `@/shared/<module>` from the owning module.
  Do not restore a Shared root barrel or expose private source files to bypass
  this boundary.
- Declare deliberate public module exports, not one export per implementation
  file. Entry symbols remain explicit; use the current module map and accepted
  records rather than copying a fixed export list into rules.
- When changing a public symbol, review its definition, owning entry, export
  declaration, and affected producers/consumers together. Do not silently break
  existing consumers or migrate unrelated symbols because they share a file.
- Adding, removing, merging, or renaming a Shared public module requires an
  accepted module-map decision or amendment and a compatibility strategy.
- Migrate intended application, test, script, documentation, and tooling
  consumers; resolve stale entries/imports before claiming completion. Verify
  consumer compatibility (`shared/public-exports.spec.ts` and affected call
  sites).

## Build and validation configuration

- Discover TypeScript paths (`@/*`), import conventions, and validation-library
  compatibility from root `tsconfig.json` and existing checks. Do not add an
  unnecessary parallel build/validation system for contracts that already live
  in this package.
