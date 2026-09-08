# ADR-007: Frontend Auth Feature public seam

**Status:** Accepted
**Date:** 2026-09-08
**Scope:** `apps/web/features/auth` intentional public barrel (`@/features/auth`)
only. Does not change Auth runtime behavior, App Shell, Site Chrome,
Navigation, Shared, shelf/reader-parts, or reading-state recorded seams.

Related: [`.cursor/rules/frontend.mdc`](../../.cursor/rules/frontend.mdc) ·
[`docs/adr/005-frontend-app-shell-site-chrome-ownership.md`](./005-frontend-app-shell-site-chrome-ownership.md)
(separate App Shell / Site Chrome record; deliberately left Auth Viewer
entrypoints out of that decision) ·
[`docs/adr/006-frontend-shelf-and-reader-parts-public-seams.md`](./006-frontend-shelf-and-reader-parts-public-seams.md)
(separate shelf / reader-parts seam record; not superseded here)

---

## Context

Frontend rules treat Feature internals as **private by default**. Presence of
`features/auth/index.ts`, or a symbol being exported from that file today, does
**not** by itself make every Auth export a cross-boundary public contract. A
recorded intentional public seam requires owner, explicit entry path,
documented public intent, and either a real cross-boundary consumer or an
explicit non-hypothetical stable public contract / framework requirement.

At record time, `apps/web/features/auth/index.ts` still re-exports a mixed
surface: app-level dialog composition (`AuthDialogProvider`, `useAuthDialog`),
route-only forms (`VerifyEmailForm`, `ResetPasswordForm`), layout atoms and
styles, dialog internals, and `useRequireAuth` (no runtime or test consumer).
That historical barrel is current code reality; it is not the approved public
contract.

ADR-005 explicitly left Auth Feature `index` / dialog providers as a separate
ownership question. This ADR closes that Auth public-seam decide gate only. It
does not reopen App Shell or Site Chrome decisions.

---

## Decision

`@/features/auth` (`apps/web/features/auth/index.ts`) is the intentional
public entry of the Auth Feature. Only the following symbols are approved for
cross-boundary use through that entry:

| Field                   | Value                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Owner                   | `features/auth`                                                                                                                |
| Public entry            | `@/features/auth` (`apps/web/features/auth/index.ts`)                                                                          |
| Approved public symbols | `AuthDialogProvider`, `useAuthDialog`                                                                                          |
| Role                    | App-wide auth dialog composition: provider mount and open/close/switch controller for login / register / forgot-password flows |

This ADR records the approved contract. At record time the barrel still exports
additional historical symbols; those exports are **not** approved public
surface. Narrowing the barrel is deferred to WP-B2 and is **not** performed by
this ADR.

### Route-only composition (not Feature public seam)

| Symbol              | Current consumer                                           | Disposition                                                                                                   |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `VerifyEmailForm`   | `app/(auth)/verify-email/page.tsx` via `@/features/auth`   | Route / framework composition only. WP-B2 will switch this route to a deep import of the form implementation. |
| `ResetPasswordForm` | `app/(auth)/reset-password/page.tsx` via `@/features/auth` | Same as above.                                                                                                |
| `AuthLayout`        | `app/(auth)/layout.tsx` via `@/features/auth/auth-layout`  | Already a route deep import; keep that pattern. Do **not** add `AuthLayout` to the Feature public barrel.     |

App Router `page` / `layout` may compose Auth page implementations (framework
composition exception). That is not a Feature-to-Feature public seam and does
not authorize ordinary Features to deep-import Auth private files.

### `useRequireAuth`

- Implementation remains in `auth-dialog-provider.tsx`.
- It is **not** part of the approved public barrel.
- At record time it has no runtime or test consumers outside its definition and
  the historical `index.ts` re-export.
- Do not delete the implementation in this decide record; deletion is a
  separate follow-up if desired.

### Feature-private (not public)

Keep private (including when still historically re-exported by `index.ts`):

- `AuthDialog`, `AuthMode`, `AuthReason`
- `SignInForm`, `SignUpForm`, `ForgotPasswordForm`
- `auth-field` atoms and style class names (`Field`, `authInputClassName`,
  `authPrimaryButtonClassName`, and related)
- `AuthIntro`, `AuthPanel`, `AuthFooterAction`, `AuthFooterLink`, and other
  layout atoms besides the route-owned `AuthLayout` deep-import pattern above
- `auth-social-login` and other Auth internals

### Recorded consumers (verified)

| Surface                                    | Consumer                             | Role                                                 |
| ------------------------------------------ | ------------------------------------ | ---------------------------------------------------- |
| `AuthDialogProvider` via `@/features/auth` | `components/providers.tsx`           | App-level composition consumer (root providers tree) |
| `useAuthDialog` via `@/features/auth`      | `features/landing/landing-auth.tsx`  | Landing opens register dialog                        |
| `useAuthDialog` via `@/features/auth`      | `features/reader/reader-page.tsx`    | Reader opens login dialog                            |
| `useAuthDialog` via `@/features/auth`      | `features/admin/admin-shell.tsx`     | Admin shell opens login dialog                       |
| `useAuthDialog` via `@/features/auth`      | `components/navigation/site-nav.tsx` | Site chrome opens login dialog                       |

Verified at record time: no other Feature deep-imports Auth private
implementation files. Deep imports of `@/features/auth/*` outside Auth itself
are limited to the route layout deep import of `AuthLayout` noted above.

### Dependency direction

Allowed:

```text
app-level composition (e.g. providers.tsx)
  →  Auth intentional public seam (@/features/auth)

ordinary Feature / Navigation public consumers
  →  Auth intentional public seam (@/features/auth)
     (AuthDialogProvider, useAuthDialog only)

route / layout composition (app/(auth)/**)
  →  Auth route implementation deep imports
     (AuthLayout; after WP-B2 also VerifyEmailForm / ResetPasswordForm)
```

Forbidden:

- Other Features must not import Auth private implementation files.
- Auth private implementation must not be treated as public merely because it
  appears in the historical `index.ts` export list.
- This decision does not authorize reverse ownership (consumers do not own Auth
  symbols).

### Explicit non-moves in this decision

This decision deliberately does **not**:

- delete `useRequireAuth` implementation;
- modify `auth/index.ts` (barrel narrowing is WP-B2);
- modify route imports under `app/(auth)/**`;
- change login, register, dialog, providers, or authentication runtime
  behavior;
- reopen ADR-005 App Shell / Site Chrome decisions;
- change Shared, shelf/reader-parts, or reading-state recorded seams;
- decide admin/reader directory structure.

### Lifecycle

Promoting a new Auth symbol to the intentional public barrel, or adding a new
cross-boundary consumer of the public seam, requires a new ownership review:
re-confirm owner, entry path, consumers, lifecycle, and dependency direction,
then update this ADR or a successor. Do not treat historical barrel exports as
a whitelist.

### Migration note (WP-B2)

A later work package (WP-B2) will:

1. narrow `features/auth/index.ts` to export only `AuthDialogProvider` and
   `useAuthDialog`; and
2. change `VerifyEmailForm` and `ResetPasswordForm` route imports to deep
   imports of their implementation files.

This ADR records the decide outcome only; it does **not** execute that
migration.

---

## Consequences

- New code must not use Auth private symbols merely because they still appear
  in `index.ts`. Approved cross-boundary symbols are only
  `AuthDialogProvider` and `useAuthDialog`.
- Route entry modules may continue to use framework composition deep imports
  for Auth page/layout implementations.
- Agents judging Auth public/private questions should load this ADR for the
  approved contract and `frontend.mdc` for reusable judgment criteria.
- ADR-005 remains scoped to App Shell / Site Chrome ownership only.
- ADR-006 remains scoped to shelf / reader-parts seams only.
