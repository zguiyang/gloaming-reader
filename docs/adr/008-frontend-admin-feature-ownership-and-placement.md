# ADR-008: Frontend Admin Feature ownership, composition, and placement

**Status:** Accepted
**Date:** 2026-09-08
**Scope:** Internal ownership and new-code placement for
`apps/web/features/admin` and its App Router composition under
`apps/web/app/admin/**`. Records AdminShell as admin-scoped
application-composition without relocating it. Does **not** change runtime
behavior, APIs, query contracts, domain contracts, or introduce an Admin Feature
public seam. WP-A2 (below) records the completed neutral rename of the shared
invocation logs filter helper. A path-only directory sync (2026-09-08) moved AI /
TTS / taxonomy files under `features/admin/{ai,tts,taxonomy}/**` without changing
ownership decisions; AdminShell relocation and further AI/TTS config/logs splits
remain deferred.

Related: [`.cursor/rules/frontend.mdc`](../../.cursor/rules/frontend.mdc) ·
[`.cursor/rules/repository-structure.mdc`](../../.cursor/rules/repository-structure.mdc) ·
[`docs/adr/005-frontend-app-shell-site-chrome-ownership.md`](./005-frontend-app-shell-site-chrome-ownership.md)
(App Shell / Site Chrome; not superseded) ·
[`docs/adr/006-frontend-shelf-and-reader-parts-public-seams.md`](./006-frontend-shelf-and-reader-parts-public-seams.md)
(shelf / reader-parts seams; not superseded) ·
[`docs/adr/007-frontend-auth-feature-public-seam.md`](./007-frontend-auth-feature-public-seam.md)
(Auth public seam; AdminShell may use `useAuthDialog`; not superseded)

---

## Context

`features/admin` is not one flat cohesive capability. It already contains
several stable ownership clusters that change for different operational
reasons: works, dictionary, AI configuration and AI logs, TTS configuration and
TTS logs, taxonomy, AdminShell composition, and Admin-level chrome helpers.

Path expression today:

| Expression               | Examples                                                         |
| ------------------------ | ---------------------------------------------------------------- |
| Capability subdirectory  | `works/**`, `dictionary/**`, `ai/**`, `tts/**`, `taxonomy/**`    |
| Filename at Feature root | `admin-shell`, `admin-segmented-tabs`, `invocation-logs-filters` |

Capability clusters use subdirectories to express ownership. Filename prefixes
remain discovery signals within a cluster; they are not automatic split criteria
and do not by themselves authorize a generic `shared` / `common` layer.
AdminShell and Admin-level chrome / neutral helpers remain at the Feature root
until a separate decide relocates them.

Admin has no intentional cross-Feature public seam. App Router `page` / `layout`
modules deep-import Admin page and shell implementations under the framework
composition exception in `frontend.mdc`. That is not permission for other
Features to import Admin private files, and it is not a reason to invent
`features/admin/index.ts` as a public barrel.

---

## Decision

### Admin Feature is multi-cluster

Treat `apps/web/features/admin` as a Feature root that hosts multiple stable
capability and composition owners. Do not place new code as if the root were a
single undifferentiated module.

### AdminShell (admin-scoped application-composition)

| Field                           | Value                                                                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semantic role                   | Admin-scoped **application-composition** (not an ordinary Admin business capability)                                                                                        |
| Current path                    | `apps/web/features/admin/admin-shell.tsx` (`@/features/admin/admin-shell`)                                                                                                  |
| Path disposition                | **Temporarily retained** under `features/admin/`. Relocating the path requires a separate decide gate.                                                                      |
| Owns                            | Session pending gate, unauthenticated prompt, admin role gate (`isAdminRole`), Admin brand mark, Admin nav (desktop + mobile sheet), scrollable main chrome for `/admin/**` |
| Does not own                    | Works / AI / TTS / taxonomy / dictionary page logic, segmented tabs chrome, logs filters, or other capability internals                                                     |
| Allowed consumer (verified)     | `apps/web/app/admin/layout.tsx` only                                                                                                                                        |
| Outward dependencies (verified) | Generic UI / `BrandMark`, `lib/auth`, `constants`, Auth public seam `useAuthDialog`, `@gloaming/shared/auth`                                                                |

Rules:

- Only App Router `layout` / route composition may assemble `AdminShell`.
- Ordinary Admin capability modules must **not** import `admin-shell.tsx` or
  otherwise depend on AdminShell private implementation.
- AdminShell must not import Admin capability page or private implementation
  files (current code satisfies this).

### Capability ownership (current paths)

Ownership follows semantic responsibility, not consumer count.

| Owner      | Current paths (verified)                                                                                                                                           | Route composition (verified)                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| works      | `features/admin/works/**`                                                                                                                                          | `app/admin/works/**` → list / edit / preview pages       |
| dictionary | `features/admin/dictionary/**`                                                                                                                                     | `app/admin/dictionary/page.tsx` → `DictionaryConfigPage` |
| AI         | `features/admin/ai/**` (`ai-config-*`, `ai-model-*`, `ai-provider-*`, `ai-purpose-*`, `ai-logs-page`, `ai-logs-api`, `ai-log-detail-sheet`; not the shared filter) | `app/admin/ai/page.tsx`, `app/admin/ai-logs/page.tsx`    |
| TTS        | `features/admin/tts/**` (`tts-config-*`, `tts-logs-page`, `tts-logs-api`; not the shared filter)                                                                   | `app/admin/tts/page.tsx`, `app/admin/tts-logs/page.tsx`  |
| taxonomy   | `features/admin/taxonomy/**` (`taxonomy-api.ts`, `taxonomy-page.tsx`, `taxonomy-picker.tsx`)                                                                       | `app/admin/taxonomy/page.tsx` → `TaxonomyPage`           |

Notes:

- `taxonomy-picker.tsx` is owned by **taxonomy**. Its verified Admin consumer is
  `works/metadata-review-panel.tsx`. A single consumer does **not** move
  ownership into works.
- AI, TTS, and taxonomy path expression is now under
  `features/admin/{ai,tts,taxonomy}/**` (path-only; ownership unchanged). This
  ADR does **not** require further internal config/logs splits within AI or TTS.
- works and dictionary keep their existing subdirectories.

### Admin-level chrome / neutral helpers

| Symbol path                   | Owner                                                               | Verified consumers                                                                                       |
| ----------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `admin-segmented-tabs.tsx`    | Admin-level chrome helper (Admin Feature internal)                  | `ai-config-page`, `ai-provider-workspace`, `invocation-logs-filters`, `taxonomy-page`, `works-list-page` |
| `invocation-logs-filters.tsx` | Admin-level **neutral** logs filter helper (Admin Feature internal) | `ai-logs-page`, `tts-logs-page`                                                                          |

Keep these helpers inside Admin with a clear Admin-internal role. Multiple Admin
consumers do **not** authorize `admin/shared`, `admin/common`, or a `logs/`
subdirectory created only for this one helper.

### WP-A2: invocation logs filter ownership (completed)

**Status:** Completed (same Accepted ADR; no successor ADR required).

Former path `ai-logs-filters.tsx` and symbols `AiLogsFilters` / `AiLogsRange*` /
`AiLogsStatusFilter` implied AI-only ownership while both AI and TTS logs pages
consumed one implementation. WP-A2 closed that mismatch:

| Field                    | Decision                                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Path                     | `features/admin/invocation-logs-filters.tsx` (Admin Feature root; **not** under `logs/`, `shared/`, or `common`)                              |
| Owner                    | Admin-level neutral helper for shared invocation-logs filter UI (time range + status tabs)                                                    |
| Single implementation    | Yes — AI and TTS logs share one filter; do not fork into AI/TTS copies without a new decide                                                   |
| Does not own             | AI/TTS page composition, `*-logs-api`, domain log row types, stats, or Shared `@gloaming/shared/ai-invocations` / `tts-invocations` contracts |
| Window / domain strategy | Each page injects its own `windowForDays` (AI → `aiInvocationWindowForDays`; TTS → `ttsInvocationWindowForDays`)                              |
| Old name                 | `ai-logs-filters` / `AiLogs*` **no longer** represent the owner; do not place new code under that name                                        |

Placement dry run (post WP-A2):

| New code                             | Owner / path                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| AI-only provider (or similar) filter | AI cluster (`ai/**` / page composition); may compose with `invocation-logs-filters` |
| TTS-only voice (or similar) filter   | TTS cluster (`tts/**` / page composition)                                           |
| Filter both AI and TTS logs need     | Extend `invocation-logs-filters` (single Admin neutral helper)                      |
| Page-only logs UI / API              | Owning AI or TTS capability                                                         |

WP-A2 deliberately did **not**: create `admin/logs`, `admin/shared`, or
`admin/common`; relocate AdminShell; change Shared packages, routes, or runtime
query contracts. (Directory path expression for AI / TTS / taxonomy was completed
later as a separate path-only sync; see Scope.)

### Dependency direction

Allowed:

```text
app/admin/** (route / layout)
  → AdminShell and/or Admin *Page implementations

Admin capability modules
  → generic UI / lib / constants
  → recorded Feature public seams when needed
    (e.g. Auth `useAuthDialog` from AdminShell; content `ReadingPartView` from works preview)
  → other Admin capability public-within-Admin surfaces only when ownership allows
    (e.g. works → taxonomy-picker; AI logs → AI config API within Admin)

AdminShell
  → generic UI / lib / constants / Auth public seam / shared auth policy
```

Forbidden:

```text
Admin capability → AdminShell private implementation (admin-shell.tsx)
ordinary Feature → Admin private files (no Admin Feature public seam recorded)
Admin → invent unrecorded Feature public barrel / deep-export for cross-Feature use
```

Verified at record time:

- No `features/admin/index.ts`.
- No consumer of `@/features/admin/**` outside `app/admin/**` and
  `features/admin/**`.
- No Admin capability file imports `admin-shell` / `AdminShell`.

### Placement test for new Admin code

Before adding a file under `features/admin`:

1. State the semantic owner and reason to change.
2. Prefer an existing owner:
   - works → `works/`
   - dictionary → `dictionary/`
   - AI → `ai/` (existing `ai-*` cluster; further config/logs split needs a later decide)
   - TTS → `tts/` (existing `tts-*` cluster)
   - taxonomy → `taxonomy/` (including picker variants)
   - AdminShell-level nav / session / role chrome → `admin-shell.tsx` (or a
     future composition path after a separate decide)
   - Admin segmented-tabs chrome → `admin-segmented-tabs.tsx` (or same owner)
   - Shared AI+TTS invocation logs filter UI → `invocation-logs-filters.tsx`
     (neutral helper; domain window via page-injected `windowForDays`)
3. Page-only UI stays with that page’s capability cluster.
4. A genuinely new operational capability may start a new named cluster; update
   AdminShell nav when the route is added.
5. If two owners remain plausible after bounded research → **stop & ask**. Do
   not resolve ambiguity with `admin/shared`, `admin/common`, or by dumping
   into a semantically wrong existing file.
6. Do not split, promote, or create directories using LOC, file count, consumer count,
   or prefix count alone.

### `admin/shared` / `admin/common` constraint

Do **not** create `admin/shared`, `admin/common`, or similarly ownerless catch-all
directories because multiple Admin modules happen to import the same helper.

A future Admin-level shared module is allowed only after an explicit decide that
records:

- a named Admin-level owner and stable responsibility;
- inward / outward dependency direction;
- why existing capability or chrome owners are insufficient.

### Non-template clause

Concrete paths above document one Accepted layout. Future Admin surfaces must
re-read source and this ADR; they must not copy directory depth or prefix style
as a mandatory symmetric template.

### Explicit non-moves in this decision

This decision deliberately does **not**:

- migrate `AdminShell` out of `features/admin/` (path still deferred; independent
  decide gate required);
- further split AI or TTS internal config/logs trees beyond the current
  `ai/**` / `tts/**` path expression;
- create `admin/shared`, `admin/common`, or `admin/logs` (WP-A2 rename stayed
  at the Admin Feature root; `invocation-logs-filters` and
  `admin-segmented-tabs` remain root helpers);
- change App Router routes, runtime behavior, APIs, or product flows;
- reopen Shared package boundaries, App Shell, Site Chrome / Navigation, Auth
  public seam, reading-state seams, or shelf / reader-parts seams;
- decide broader admin/reader implementation directory trees beyond the Admin
  ownership and placement rules recorded here.

(WP-A2 renamed `ai-logs-filters` → `invocation-logs-filters` in place; that
rename is complete and is **not** a deferred item. Path-only directory
expression for taxonomy / AI / TTS under `features/admin/{taxonomy,ai,tts}/**`
is complete as of 2026-09-08; ownership, runtime, and public-seam decisions are
unchanged.)

---

## Consequences

- New Admin code can be placed by **ownership** (works, dictionary, AI, TTS,
  taxonomy, AdminShell composition, Admin chrome / neutral helpers), not only
  by copying filename prefixes.
- AI / TTS / taxonomy live under `features/admin/{ai,tts,taxonomy}/**`
  (path-only expression). Further AI/TTS config/logs splits are **not**
  required by this ADR.
- Moving AdminShell’s path requires an independent investigate → decide gate.
- Shared AI+TTS invocation logs filter UI lives at
  `invocation-logs-filters.tsx`; agents must not invent `admin/shared` /
  `admin/common` / `admin/logs` for that helper, and must not treat the retired
  `ai-logs-filters` name as the owner.
- Agents must not add an Admin Feature public barrel without a real
  cross-Feature consumer (or explicit non-hypothetical stable contract /
  framework requirement) and a successor ADR.
- Capability modules that import `admin-shell.tsx` are a boundary violation
  under this record.

### Lifecycle

Changing AdminShell’s path, introducing an Admin Feature public seam, creating
an Admin-level catch-all directory, or further splitting AI / TTS config/logs
beyond the current `ai/**` / `tts/**` trees requires a new decide pass:
re-confirm owners, consumers, dependency direction, and old-boundary
disposition, then update this ADR or a successor.
