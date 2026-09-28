# ADR-006: Frontend Library and reader-parts recorded public seams

**Status:** Accepted
**Date:** 2026-09-08
**Scope:** `apps/web/features/library/library-public.ts` and
`apps/web/features/reader/reader-parts-public.ts` cross-Feature public seams.
The User-first amendment updates the Library Shared subpath only; it does not
change Auth, App Shell, Site Chrome, Navigation, or reading-state seams.

Related: [`.cursor/rules/frontend.mdc`](../../.cursor/rules/frontend.mdc) ·
[`docs/adr/004-frontend-reading-state-public-seams.md`](./004-frontend-reading-state-public-seams.md)
(separate reading-state seam record; not superseded here) ·
[`docs/adr/005-frontend-app-shell-site-chrome-ownership.md`](./005-frontend-app-shell-site-chrome-ownership.md)
(separate App Shell / Site Chrome record; not superseded here)

**User-first amendment (2026-09-28):** PR-05 retires the Shelf module seam and
replaces it with the Library seam below. `/my-shelf` remains the existing route;
the runtime API and Shared contract are `/api/library` and
`@gloaming/shared/library`. Continue Reading is a separate progress projection,
not Library membership. This amendment supersedes older statements here that
prohibited renaming the Shelf seam.

---

## Context

Frontend rules treat Feature internals as **private by default**. A filename
suffix such as `*-public.ts` is a naming convention only; it does not grant
cross-boundary permission by itself. A recorded intentional public seam
requires owner, explicit entry path, documented public intent, and either a
real cross-boundary consumer or an explicit non-hypothetical stable public
contract / framework requirement.

`library-public` and `reader-parts-public` already have real cross-Feature
consumers. Recording them prevents a future cleanup from treating these files
as internal-only and deleting, merging, or deep-rewiring them solely because
of the default-private rule. This ADR documents the current approved contract;
it does not approve additional directory migration, file merges, or runtime
behavior changes beyond the explicit User-first amendment.

---

## Decision

The following two files are intentional public seams of their owning Features.
They are **not** a precedent that every `*-public.ts`, `*-api.ts`,
`*-client.ts`, or Feature `index.ts` is public.

### `library-public`

| Field                                                   | Value                                                                                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Owner                                                   | `features/library`                                                                                                                       |
| Public entry                                            | `@/features/library/library-public` (`apps/web/features/library/library-public.ts`)                                                      |
| Approved public symbols                                 | `getLibrary`, `buildLibraryItemMap`                                                                                                      |
| Role                                                    | Cross-Feature Library data access and membership-only item indexing. Continue Reading stays separate. No hooks or pages.                 |
| Cross-Feature consumers (verified)                      | `features/book-detail/book-detail-api.ts`, `features/discover/discover-api.ts`                                                           |
| Same-Feature consumers (not the cross-Feature contract) | `features/library/library-api.ts` (`getLibrary`), plus owner unit test `features/library/library-public.spec.ts` (`buildLibraryItemMap`) |

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

Same-Feature imports (for example `library-api` → `library-public`, or
`reader-api` → `reader-parts-public`) are owner-internal composition. They
demonstrate that the seam is used inside the owner Feature; they do **not** by
themselves establish or widen the cross-Feature public contract. The
cross-Feature contract is defined by the approved symbols above and the
verified cross-Feature consumers.

### Dependency direction

Allowed:

```text
book-detail  →  library-public
discover     →  library-public
book-detail  →  reader-parts-public
library (owner internals) →  library-public
reader (owner internals)  →  reader-parts-public
```

Forbidden reverse / cyclic dependencies for these seams:

- `library` must not depend on `book-detail` or `discover` to satisfy Library data
  access.
- `reader` must not depend on `book-detail` to satisfy work-parts data access.
- Consumers must import only the recorded public entries above; they must not
  deep-import Library or reader private implementation for these capabilities.

Verified at PR-05: no other Feature deep-imports Library or reader private
implementation for Library data or work-parts data; no reverse dependency from
`library`/`reader` into `book-detail`/`discover` for these seams.

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

- merge or relocate `library-public` or `reader-parts-public`;
- change runtime behavior of `getLibrary`, `buildLibraryItemMap`, or `getWorkParts`;
- narrow or redesign Auth (`auth/index.ts`, `useRequireAuth`);
- change broader Shared package rules, App Shell, Site Chrome, Navigation, or
  reading-state recorded decisions;
- create a generic `shared` / `common` directory;
- decide admin/reader directory structure.

The legacy Shelf seam rename is complete under the explicit User-first
decision; other Feature ownership changes still require their own gates.

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
