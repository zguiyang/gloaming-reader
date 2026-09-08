# ADR-005: Frontend App Shell and Site Chrome Ownership

**Status:** Accepted
**Date:** 2026-09-08
**Scope:** Frontend application-composition ownership for App Shell and site
chrome (Navigation). Does not change Providers, Auth Viewer entrypoints, or
other Feature public surfaces.

Related: [`.cursor/rules/frontend.mdc`](../../.cursor/rules/frontend.mdc) ·
[`docs/adr/004-frontend-reading-state-public-seams.md`](./004-frontend-reading-state-public-seams.md)
(separate reading-state seam record; not superseded here)

---

## Context

Learner-facing pages need shared top chrome and, inside the authenticated app
group, a mobile bottom tab bar. Landing also needs the same top chrome, but
Landing is an ordinary Feature and must not own site-chrome assembly.

A prior implementation left a thin `@/components/site-nav` facade and allowed
Landing to import site chrome directly. The accepted decision is to treat App
Shell and Navigation as application-composition boundaries with a narrow public
entry, and to compose Landing chrome at the route layer.

This ADR records the **concrete** ownership and entry choices. It is not a
permanent directory template for every future Navigation or Feature layout.

---

## Decision

### App Shell semantic role

- `features/app-shell` is an **application-composition** boundary, not an
  ordinary business Feature.
- It owns authenticated app-group shell composition: session pending gate,
  top site chrome, scrollable main content, and mobile bottom chrome.
- It may depend on generic components, `lib`, `constants`, and recorded Feature
  public seams.
- Ordinary Features must not import App Shell implementation.

### Site Chrome / Navigation ownership

- `components/navigation` owns site chrome for Landing and App Shell.
- **Public entry (current):** `@/components/navigation`
  (`components/navigation/index.ts`)
- **Public symbols (current):** named exports only — `SiteNav`,
  `MobileBottomNav`
- **Private (current):** `AccountMenu`, `DesktopNav`, `ThemeModeNavButton`,
  `nav-config`, and other files under `components/navigation/` that are not
  re-exported by the public entry
- Cross-boundary consumers must not import Navigation private implementation
  files. The former facade `components/site-nav.tsx` is removed; do not restore
  it without a new decide pass.

### Landing and Site Chrome composition

- Ordinary Landing Feature code must not depend on Site Chrome directly.
- **Current composition owner:** `app/page.tsx` composes
  `LandingNavEntrance` (Landing public named export), `SiteNav` (Navigation
  public entry), and `LandingPage` (Landing content + footer).
- `LandingPage` owns Landing main content and footer only.
- `LandingNavEntrance` remains a Landing motion concern; its public export for
  route composition is the Landing Feature `index.ts` named export.

### Route / layout composition exception

- App Router `page` / `layout` may compose Feature page implementations and
  application-composition surfaces (framework requirement).
- Current layout consumer: `app/(app)/layout.tsx` composes `AppShell`.
- This exception does not authorize ordinary Feature internals to deep-import
  application-composition or another Feature’s private files.

### Recorded consumers (current)

| Surface                                                      | Consumer                           |
| ------------------------------------------------------------ | ---------------------------------- |
| `SiteNav` + `MobileBottomNav` via `@/components/navigation`  | `features/app-shell/app-shell.tsx` |
| `SiteNav` via `@/components/navigation`                      | `app/page.tsx` (Landing chrome)    |
| `AppShell`                                                   | `app/(app)/layout.tsx`             |
| `LandingNavEntrance`, `LandingPage` via `@/features/landing` | `app/page.tsx`                     |

### Why ordinary Features must not own Site Chrome

Site chrome changes for app-wide navigation and account UX, not for a single
capability’s content. Letting Landing (or any ordinary Feature) import chrome
internals couples Feature content to shell assembly and invites duplicate or
divergent headers.

### Explicit non-moves in this decision

This decision deliberately does **not** relocate or redesign:

- root Providers;
- Auth Feature `index` / dialog providers;
- Navigation internals under `components/navigation/**` (aside from adding the
  narrow public entry);
- App Shell directory location;
- other Feature public surfaces.

Those remain separate ownership questions and require their own investigate →
decide gates.

### Lifecycle

Adding, removing, renaming, or widening public chrome entries requires a new
decide pass: re-confirm owner, entry, consumers, and old-boundary disposition,
then update this ADR or a successor. Do not treat this file as a whitelist that
makes every similarly named Navigation or Feature path public.

### Non-template clause

Concrete paths and symbols above document one Accepted layout. Future Features
and chrome surfaces must re-read source and architecture records; they must not
copy this directory shape as a mandatory template.

---

## Consequences

- Agents judging App Shell / Site Chrome questions should load this ADR for
  current ownership facts and `frontend.mdc` for reusable judgment criteria.
- ADR-004 remains scoped to reading-state seams only.
- Restoring `@/components/site-nav`, exporting Navigation internals, or moving
  Landing chrome back into the Feature without a decide pass is a regression.
