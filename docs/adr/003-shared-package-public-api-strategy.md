# ADR-003: Shared Package Public API Strategy

**Status:** Accepted  
**Date:** 2026-09-07  
**Amended:** 2026-09-08 (root facade removal)
**Scope:** `@gloaming/shared` package public entrypoints only

Related: [`.cursor/rules/packages.mdc`](../../.cursor/rules/packages.mdc) ·
[`packages/shared/package.json`](../../packages/shared/package.json) ·
[`packages/shared/src/public-exports.spec.ts`](../../packages/shared/src/public-exports.spec.ts)

---

## Context

`@gloaming/shared` is the cross-app surface for contracts, schemas, types, and
pure policy used by `apps/web` and `apps/backend`. It must not own application
workflows or leak runtime implementation.

### Historical background (pre-amendment)

The package previously exposed a large explicit root facade (hundreds of named
exports from many source modules). Most consumers imported from a single
logical area, but the flat root namespace and long `index.ts` invited a recurring
question: should Shared grow official domain public subpaths?

Earlier governance collapsed historical multi-path / deep-import usage into a
single root facade so that package internals could not become an accidental
public API. That root facade then served as a **temporary compatibility layer**
while semantic module entrypoints became the target API and apps consumers
migrated in bounded waves.

---

## Decision

1. `@gloaming/shared` adopts official semantic module subpaths.
2. Each public module is a directory with its own explicit `index.ts`.
3. `package.json` declares one export per public module, targeting that module
   entrypoint; it does not declare one export per source file.
4. **(Superseded 2026-09-08 — see Amendment.)** The original decision temporarily
   retained the root `@gloaming/shared` entrypoint as a compatibility facade
   during consumer migration. That temporary policy no longer applies.
5. New consumers use the owning module subpath. Existing root consumers migrate
   in bounded waves (completed before root removal).
6. Internal implementation files remain private, and official subpaths must not
   expose `src/` deep imports.

### Amendment: Root facade removal (2026-09-08)

An independent package public-boundary decision (separate from ordinary module
lifecycle or consumer-migration waves) confirmed removal of the root facade
after a full-workspace consumer audit found no supported apps or workspace
executable root consumers, and after verifying the root re-exported only symbols
already present on module entrypoints (no unique root surface).

**Current policy:**

- The only public entrypoints are the 19 official module subpaths listed below.
- `package.json` must not declare `exports["."]`.
- `packages/shared/src/index.ts` is removed and must not be restored as a giant
  facade.
- `packages/shared/src/public-exports.spec.ts` guards package exports and module
  entrypoints; it does **not** assert root compatibility.
- New consumers must import `@gloaming/shared/<module>` from the owning module.
- Shared module lifecycle rules (add / remove / merge / rename) remain in force
  via `.cursor/rules/packages.mdc` and the repository-structure protocol.
- Reintroducing a root entrypoint requires a new independent ADR or Accepted
  amendment plus an explicit compatibility decision; it is not a default.

### Initial public module map

The following semantic modules are accepted for the first migration baseline
and remain the current public module map after root removal:

| Module          | Public subpath                     | Scope                                                 |
| --------------- | ---------------------------------- | ----------------------------------------------------- |
| auth            | `@gloaming/shared/auth`            | auth policy and role policy                           |
| pagination      | `@gloaming/shared/pagination`      | pagination and sorting contract                       |
| works           | `@gloaming/shared/works`           | Work, Part, catalog, and admin-work contracts         |
| reader          | `@gloaming/shared/reader`          | reading state and reader session contracts            |
| reading-history | `@gloaming/shared/reading-history` | reading activity and history contracts                |
| reading-stats   | `@gloaming/shared/reading-stats`   | work-stat derivation policy                           |
| shelf           | `@gloaming/shared/shelf`           | shelf projection contracts                            |
| recommendations | `@gloaming/shared/recommendations` | recommendation query and result contracts             |
| dictionary      | `@gloaming/shared/dictionary`      | dictionary configuration and lookup contracts         |
| translate       | `@gloaming/shared/translate`       | translation and bilingual-cache contracts             |
| assist          | `@gloaming/shared/assist`          | assist request and stream contracts                   |
| conversations   | `@gloaming/shared/conversations`   | conversation and message contracts                    |
| taxonomy        | `@gloaming/shared/taxonomy`        | taxonomy contracts                                    |
| tts             | `@gloaming/shared/tts`             | TTS configuration, voices, and timing contracts       |
| tts-invocations | `@gloaming/shared/tts-invocations` | TTS invocation log contracts                          |
| content-assets  | `@gloaming/shared/content-assets`  | ContentAsset and audio-asset contracts                |
| assets          | `@gloaming/shared/assets`          | object-store health scan and orphan cleanup contracts |
| llm             | `@gloaming/shared/llm`             | LLM configuration, keys, and wire registry            |
| ai-invocations  | `@gloaming/shared/ai-invocations`  | AI invocation log contracts                           |

This map is a public-boundary baseline, not a mandate that every module keep
one source file. Internal files may be split or reorganized while the public
module remains stable. A future module addition, merge, or removal must pass
the repository-structure decision protocol and update this ADR or its successor.

### Terminology

| Term                           | Meaning                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Official public subpath**    | A path the package author declares in `exports` as part of the supported public API (for example `@gloaming/db/schema`).             |
| **Implementation deep import** | A consumer dependency on internal source layout that bypasses the declared public boundary (for example `@gloaming/shared/src/...`). |

An official subpath is a supported package API, not a shortcut into source
layout. For example, `@gloaming/shared/works` is valid only because the package
declares it and `src/works/index.ts` owns its public surface;
`@gloaming/shared/src/api/works.ts` remains invalid.

---

## Rationale

- **Discoverability** — The import path identifies the semantic owner for humans
  and agents.
- **Encapsulation** — `package.json` and module entrypoints prevent source files
  from becoming accidental public APIs.
- **Controlled migration (historical)** — The temporary root facade allowed
  existing root imports to migrate in waves without a single flag day.
- **Post-migration simplicity** — After consumers moved to module subpaths, the
  compatibility root added no unique surface and was removed by a separate
  decision rather than left as an accidental default.
- **Semantic grouping** — A module may contain multiple internal files without
  exposing every file as a package entrypoint.
- **Simple evolution** — Adding or removing a domain module changes one explicit
  export and one module entrypoint rather than enlarging an undifferentiated
  root list.

---

## Consequences

### Accepted trade-offs

- Every public module needs an intentional entrypoint and migration ownership.
- Moving or merging a public module is an API change and needs compatibility
  analysis.
- Call sites that still used the root package entry (none confirmed in-repo at
  removal time) would break until migrated to owning module subpaths.

### Non-goals of this ADR

- Application workflows, ORM types, secrets, or runtime adapters in Shared
- Splitting every existing source file into a public module
- Creating `works/admin`, `works/catalog`, or other nested public subpaths in
  the first migration without a separate boundary decision
- Treating root removal as a side effect of an ordinary module add/remove/rename
  (root removal required this independent decision)

---

## Migration and evolution policy

**Historical (during root compatibility window):**

- The root facade could re-export existing symbols for compatibility.
- New public symbols were added to their owning module entrypoint first.
- New consumers were required to import the owning module subpath.
- Each migration wave recorded consumers, old-boundary disposition, and checks.
- The root entrypoint was removable only after a consumer audit and a separate
  decision confirmed removal.

**Current (after 2026-09-08 amendment):**

- There is no root package entrypoint.
- New public symbols are added only to their owning module entrypoint and
  `package.json` module export.
- New consumers must import the owning module subpath.
- Module lifecycle changes follow `.cursor/rules/packages.mdc` (Shared public
  module lifecycle) and the repository-structure decision protocol.

For future module changes, do **not** treat export count, `index.ts` line count,
file count, or consumer count as automatic split thresholds. Apply the
repository-structure module-boundary test. A module addition, merge, or removal
must identify its owner, public surface, affected consumers, compatibility
plan, and acceptance checks.

## Acceptance criteria

The first module-subpath migration was complete when:

- every accepted module had a directory and explicit `index.ts`;
- `package.json` exported each accepted module and no internal source file;
- module entrypoints exposed intentional symbols only;
- intended backend, web, test, and configuration consumers were migrated; and
- typecheck/lint/tests relevant to the package and consumers were run and
  reported with actual results.

The root facade removal is complete when:

- ADR current policy records the independent removal decision;
- `exports["."]` is absent;
- `packages/shared/src/index.ts` is absent;
- public-export tests assert module subpaths only (no root compatibility);
- stale current guidance no longer recommends the root entry;
- executable root and deep imports remain absent; and
- shared/backend/web verification for the change is reported with actual results.

It must not restore implementation deep imports such as
`@gloaming/shared/src/...`.

---

## Alignment

The active package rule governs the public-boundary mechanics, and the project
repository-structure rule governs future module decisions. This ADR records the
accepted Shared baseline, the completed consumer migration to module subpaths,
and the Accepted amendment that removed the root compatibility entrypoint.
