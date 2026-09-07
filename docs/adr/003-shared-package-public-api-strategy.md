# ADR-003: Shared Package Public API Strategy

**Status:** Accepted  
**Date:** 2026-09-07  
**Scope:** `@gloaming/shared` package public entrypoints only

Related: [`.cursor/rules/packages.mdc`](../../.cursor/rules/packages.mdc) ·
[`packages/shared/package.json`](../../packages/shared/package.json) ·
[`packages/shared/src/index.spec.ts`](../../packages/shared/src/index.spec.ts)

---

## Context

`@gloaming/shared` is the cross-app surface for contracts, schemas, types, and
pure policy used by `apps/web` and `apps/backend`. It must not own application
workflows or leak runtime implementation.

The package already exposes a large explicit root facade (hundreds of named
exports from many source modules). Most consumers still import from a single
logical area, but the flat root namespace and long `index.ts` invite a recurring
question: should Shared grow official domain public subpaths?

Earlier governance collapsed historical multi-path / deep-import usage into a
single root facade so that package internals could not become an accidental
public API. That boundary remains useful, but the root facade is now defined as
a compatibility layer while semantic module entrypoints become the target API.

---

## Decision

1. `@gloaming/shared` adopts official semantic module subpaths.
2. Each public module is a directory with its own explicit `index.ts`.
3. `package.json` declares one export per public module, targeting that module
   entrypoint; it does not declare one export per source file.
4. The root `@gloaming/shared` entrypoint remains temporarily as a compatibility
   facade for existing consumers. It must not grow with new module exports.
5. New consumers use the owning module subpath. Existing root consumers migrate
   in bounded waves.
6. Internal implementation files remain private, and official subpaths must not
   expose `src/` deep imports.

### Initial public module map

The following semantic modules are accepted for the first migration baseline:

| Module          | Public subpath                     | Scope                                           |
| --------------- | ---------------------------------- | ----------------------------------------------- |
| auth            | `@gloaming/shared/auth`            | auth policy and role policy                     |
| pagination      | `@gloaming/shared/pagination`      | pagination and sorting contract                 |
| works           | `@gloaming/shared/works`           | Work, Part, catalog, and admin-work contracts   |
| reader          | `@gloaming/shared/reader`          | reading state and reader session contracts      |
| reading-history | `@gloaming/shared/reading-history` | reading activity and history contracts          |
| reading-stats   | `@gloaming/shared/reading-stats`   | work-stat derivation policy                     |
| shelf           | `@gloaming/shared/shelf`           | shelf projection contracts                      |
| recommendations | `@gloaming/shared/recommendations` | recommendation query and result contracts       |
| dictionary      | `@gloaming/shared/dictionary`      | dictionary configuration and lookup contracts   |
| translate       | `@gloaming/shared/translate`       | translation and bilingual-cache contracts       |
| assist          | `@gloaming/shared/assist`          | assist request and stream contracts             |
| conversations   | `@gloaming/shared/conversations`   | conversation and message contracts              |
| taxonomy        | `@gloaming/shared/taxonomy`        | taxonomy contracts                              |
| tts             | `@gloaming/shared/tts`             | TTS configuration, voices, and timing contracts |
| tts-invocations | `@gloaming/shared/tts-invocations` | TTS invocation log contracts                    |
| content-assets  | `@gloaming/shared/content-assets`  | ContentAsset and audio-asset contracts          |
| llm             | `@gloaming/shared/llm`             | LLM configuration, keys, and wire registry      |
| ai-invocations  | `@gloaming/shared/ai-invocations`  | AI invocation log contracts                     |

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
- **Controlled compatibility** — Existing root imports do not need a flag-day
  migration, while new work follows the target boundary.
- **Semantic grouping** — A module may contain multiple internal files without
  exposing every file as a package entrypoint.
- **Simple evolution** — Adding or removing a domain module changes one explicit
  export and one module entrypoint rather than enlarging an undifferentiated
  root list.

---

## Consequences

### Accepted trade-offs

- The compatibility root remains large during migration.
- Every public module needs an intentional entrypoint and migration ownership.
- Moving or merging a public module is an API change and needs compatibility
  analysis.

### Non-goals of this ADR

- Application workflows, ORM types, secrets, or runtime adapters in Shared
- Splitting every existing source file into a public module
- Creating `works/admin`, `works/catalog`, or other nested public subpaths in
  the first migration without a separate boundary decision
- Removing the root compatibility entrypoint during the first migration wave

---

## Migration and evolution policy

During migration:

- The root facade may re-export existing symbols for compatibility.
- New public symbols are added to their owning module entrypoint first.
- New consumers must import the owning module subpath.
- Each migration wave records consumers, old-boundary disposition, and checks.
- The root entrypoint is removable only after a consumer audit proves that no
  supported consumer depends on it and a separate decision confirms removal.

For future module changes, do **not** treat export count, `index.ts` line count,
file count, or consumer count as automatic split thresholds. Apply the
repository-structure module-boundary test. A module addition, merge, or removal
must identify its owner, public surface, affected consumers, compatibility
plan, and acceptance checks.

## Acceptance criteria

The first migration is complete only when:

- every accepted module has a directory and explicit `index.ts`;
- `package.json` exports each accepted module and no internal source file;
- module entrypoints expose intentional symbols only;
- root compatibility exports remain behaviorally compatible during migration;
- intended backend, web, test, and configuration consumers are migrated or
  explicitly recorded as transition exceptions; and
- typecheck/lint/tests relevant to the package and consumers are run and
  reported with actual results.

It must not restore implementation deep imports such as
`@gloaming/shared/src/...`.

---

## Alignment

The active package rule governs the public-boundary mechanics, and the project
repository-structure rule governs future module decisions. This ADR records the
accepted Shared baseline and migration policy; it does not authorize a code
change outside the explicitly planned migration waves.
