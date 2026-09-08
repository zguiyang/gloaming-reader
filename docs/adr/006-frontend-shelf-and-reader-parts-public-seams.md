# ADR-006: Frontend shelf and reader-parts recorded public seams

**Status:** Accepted
**Date:** 2026-09-08
**Scope:** `apps/web/features/shelf/shelf-public.ts` and
`apps/web/features/reader/reader-parts-public.ts` cross-Feature public seams
only. Does not change Auth, App Shell, Site Chrome, Navigation, Shared, or
reading-state recorded seams.

Related: [`.cursor/rules/frontend.mdc`](../../.cursor/rules/frontend.mdc) ·
[`docs/adr/004-frontend-reading-state-public-seams.md`](./004-frontend-reading-state-public-seams.md)
(separate reading-state seam record; not superseded here) ·
[`docs/adr/005-frontend-app-shell-site-chrome-ownership.md`](./005-frontend-app-shell-site-chrome-ownership.md)
(separate App Shell / Site Chrome record; not superseded here)

---

## Context

Frontend rules treat Feature internals as **private by default**. A filename
suffix such as `*-public.ts` is a naming convention only; it does not grant
cross-boundary permission by itself. A recorded intentional public seam
requires owner, explicit entry path, documented public intent, and either a
real cross-boundary consumer or an explicit non-hypothetical stable public
contract / framework requirement.

`shelf-public` and `reader-parts-public` already have real cross-Feature
consumers. Recording them prevents a future cleanup from treating these files
as internal-only and deleting, merging, or deep-rewiring them solely because
of the default-private rule. This ADR documents the current approved contract;
it does not approve directory migration, file merges, or runtime behavior
changes.

---

## Decision

The following two files are intentional public seams of their owning Features.
They are **not** a precedent that every `*-public.ts`, `*-api.ts`,
`*-client.ts`, or Feature `index.ts` is public.

### `shelf-public`

| Field                                                   | Value                                                                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Owner                                                   | `features/shelf`                                                                                                             |
| Public entry                                            | `@/features/shelf/shelf-public` (`apps/web/features/shelf/shelf-public.ts`)                                                  |
| Approved public symbols                                 | `getShelf`, `buildShelfItemMap`                                                                                              |
| Role                                                    | Cross-Feature shelf data access and shelf-item indexing. No React Query hooks and no page components.                        |
| Cross-Feature consumers (verified)                      | `features/book-detail/book-detail-api.ts`, `features/discover/discover-api.ts`                                               |
| Same-Feature consumers (not the cross-Feature contract) | `features/shelf/shelf-api.ts` (`getShelf`), plus owner unit test `features/shelf/shelf-public.spec.ts` (`buildShelfItemMap`) |

### `reader-parts-public`

| Field                                                   | Value                                                                                                       |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Owner                                                   | `features/reader`                                                                                           |
| Public entry                                            | `@/features/reader/reader-parts-public` (`apps/web/features/reader/reader-parts-public.ts`)                 |
| Approved public symbols                                 | `getWorkParts`                                                                                              |
| Role                                                    | Cross-Feature reader work-parts data access. No React Query hooks and no view models.                       |
| Cross-Feature consumers (verified)                      | `features/book-detail/book-detail-api.ts`                                                                   |
| Same-Feature consumers (not the cross-Feature contract) | `features/reader/reader-api.ts` (`getWorkParts`). No dedicated unit test file for this seam at record time. |

### Same-Feature consumers are not the cross-Feature contract

Same-Feature imports (for example `shelf-api` → `shelf-public`, or
`reader-api` → `reader-parts-public`) are owner-internal composition. They
demonstrate that the seam is used inside the owner Feature; they do **not** by
themselves establish or widen the cross-Feature public contract. The
cross-Feature contract is defined by the approved symbols above and the
verified cross-Feature consumers.

### Dependency direction

Allowed:

```text
book-detail  →  shelf-public
discover     →  shelf-public
book-detail  →  reader-parts-public
shelf (owner internals)   →  shelf-public
reader (owner internals)  →  reader-parts-public
```

Forbidden reverse / cyclic dependencies for these seams:

- `shelf` must not depend on `book-detail` or `discover` to satisfy shelf data
  access.
- `reader` must not depend on `book-detail` to satisfy work-parts data access.
- Consumers must import only the recorded public entries above; they must not
  deep-import shelf or reader private implementation for these capabilities.

Verified at record time: no other Feature deep-imports shelf or reader private
implementation for shelf data or work-parts data; no reverse dependency from
`shelf`/`reader` into `book-detail`/`discover` for these seams.

### Naming is not automatic publicity

- `*-public` is an **explicit contract naming** convention used by these two
  recorded seams. It does **not** make every similarly named file across the
  repository automatically public.
- `*-api.ts`, `*-client.ts`, and Feature `index.ts` remain private by default
  and do **not** gain public semantics from this ADR.
- Presence of comments such as “cross-feature public entry” is supporting
  intent evidence; the Accepted record here is the governance source for these
  two paths.

### Route / framework composition vs Feature public seams

App Router `page` / `layout` may compose Feature page implementations (for
example `app/(reader)/read/[workId]/page.tsx` → `ReaderPage`). That is a
framework composition exception, not a Feature-to-Feature public seam and not
authorization to deep-import another Feature’s private files. This ADR records
only the two data-access seams above; it does not redefine route composition
rules from `frontend.mdc` or ADR-005.

### Explicit non-moves in this decision

This decision deliberately does **not**:

- migrate, merge, rename, or relocate `shelf-public` or `reader-parts-public`;
- change runtime behavior of `getShelf`, `buildShelfItemMap`, or `getWorkParts`;
- narrow or redesign Auth (`auth/index.ts`, `useRequireAuth`);
- change Shared, App Shell, Site Chrome, Navigation, or reading-state recorded
  decisions;
- create a generic `shared` / `common` directory;
- decide admin/reader directory structure.

Those remain separate ownership questions and require their own investigate →
decide gates.

### Lifecycle

Adding a new cross-boundary consumer, or adding, removing, renaming, or
widening approved public symbols on either seam, requires a new ownership and
dependency review: re-confirm owner, entry path, consumers, and dependency
direction, then update this ADR or a successor. Do not treat this file as a
whitelist that makes every similarly named Feature path public.

---

## Consequences

- Agents must not delete, merge, privatize, or deep-rewire these two paths
  without first migrating or dropping their recorded cross-Feature consumers
  and updating this ADR.
- New `*-public.ts` / `*-api.ts` / `*-client.ts` / `index.ts` files remain
  private until a comparable Accepted record exists for each intended public
  entry.
- ADR-004 remains scoped to reading-state seams only.
- ADR-005 remains scoped to App Shell / Site Chrome ownership only.
