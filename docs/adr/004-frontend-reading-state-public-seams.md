# ADR-004: Frontend reading-state recorded public seams

**Status:** Accepted
**Date:** 2026-09-08
**Scope:** `apps/web/features/reading-state` cross-Feature public seams only

Related: [`.cursor/rules/frontend.mdc`](../../.cursor/rules/frontend.mdc)

---

## Context

Frontend rules treat Feature `*-api.ts` and `*-client.ts` as **private by
default**. A filename suffix alone does not grant cross-boundary permission.
A recorded intentional public seam requires owner, explicit entry path,
documented public intent, and either a real cross-boundary consumer or an
explicit non-hypothetical stable public contract / framework requirement.
These reading-state seams qualify via real cross-boundary consumers.

`features/reading-state` already has such consumers. Recording them prevents a
future cleanup from treating these files as internal-only and deleting or
merging them solely because of the default-private rule.

---

## Decision

The following two files are intentional public seams of the `reading-state`
Feature. They are **not** a precedent that every `*-api.ts` / `*-client.ts` is
public.

### `reading-state-api`

| Field              | Value                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner              | `features/reading-state`                                                                                                                                         |
| Public entry       | `@/features/reading-state/reading-state-api`                                                                                                                     |
| Role               | HTTP / transport helpers for reading-state mutations and revision conflict detection                                                                             |
| Recorded consumers | `features/reader/reader-api.ts`, `features/reader/reader-page.tsx`, `features/reading-state/reading-state-client.ts` (same Feature), plus the owner’s unit tests |

### `reading-state-client`

| Field              | Value                                                   |
| ------------------ | ------------------------------------------------------- |
| Owner              | `features/reading-state`                                |
| Public entry       | `@/features/reading-state/reading-state-client`         |
| Role               | React Query mutation hooks over reading-state transport |
| Recorded consumers | `features/book-detail/book-detail-page.tsx`             |

### Why API and React Query client stay separate

- Transport helpers (`reading-state-api`) are usable from non-React modules and
  from Feature code that only needs request/response behavior.
- Client hooks (`reading-state-client`) own TanStack Query cache invalidation
  and must remain a React client boundary.
- Keeping them as two recorded seams matches the frontend rule that API access
  and React Query / client runtime may live in separate intentional seams.

### Non-precedent

- This ADR does **not** whitelist all similarly named files across Features.
- Adding or removing a cross-boundary consumer requires re-checking entry
  intent and updating this record (or an equivalent engineering note).
- Application composition code must still not import Feature private
  implementation files; only recorded seams above are in scope here.

---

## Consequences

- Agents must not delete, merge, or privatize these two paths without first
  migrating or dropping their recorded consumers and updating this ADR.
- New `*-api.ts` / `*-client.ts` files remain private until a comparable
  record exists for each intended public entry.
