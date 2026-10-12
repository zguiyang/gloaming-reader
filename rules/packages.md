# Shared packages and contracts

Identify the owning package and public module from definitions, declared
exports, consumers, and accepted decisions. Apply
[architecture rules](architecture.md) when changing boundaries.

## Ownership

- Shared application contracts have one authoritative owner. Import or derive
  controlled values, validation policy, types, and pure functions from that
  owner; do not maintain competing application-local definitions.
- A symbol belongs to the module defining its semantic contract, not the feature
  or directory consuming it. Mixed-domain imports stay separated by owner;
  co-use does not justify merging modules.
- `@gloaming/shared` owns cross-app contracts and pure policy, not ORM, secrets,
  application workflows, or backend runtime policy. `@gloaming/db` owns database
  schema and migrations. Packages must not depend on application implementation.

## Public API and compatibility

- [ADR-003](../docs/adr/003-shared-package-public-api-strategy.md) governs Shared's
  semantic module subpaths and absent root facade. Consumers use the owning
  module's declared public entry. Do not restore a Shared root entry or expose
  private source files to bypass this boundary.
- Declare deliberate public module exports, not one export per implementation
  file. Entry symbols remain explicit; use the current module map and accepted
  records rather than copying a fixed export list into rules.
- When changing a public symbol, review its definition, owning entry, export
  declaration, and affected producers/consumers together. Do not silently break
  existing consumers or migrate unrelated symbols because they share a file.
- Adding, removing, merging, or renaming a Shared public module requires an
  accepted module-map decision or amendment and a compatibility strategy.
  A root-policy change is a separate accepted decision, not an incidental module
  lifecycle change.
- Migrate intended application, test, script, documentation, and tooling
  consumers; resolve stale entries/imports and any transition conditions before
  claiming completion. Verify relevant package and consumer compatibility.

## Build and validation configuration

- Discover source/build mode, TypeScript inheritance, import conventions, and
  validation-library compatibility from package/workspace configuration and
  existing checks. Do not impose one application's setup on every package or
  add an unnecessary parallel build/validation system.
- Keep application-specific aliases and compiler options in their application;
  do not add app aliases to the shared workspace TypeScript base.
