# Web and UI

Discover current routing, state, authentication, components, and configuration
from the affected application. Do not prescribe a new library from a remembered
stack. For module ownership or public entries, read
[architecture rules](architecture.md).

## Current vs target (Web and APIs)

| State       | Meaning                                                                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Current** | Next.js UI in **`client/`**. HTTP APIs are same-origin `/api/*` Route Handlers in the same app (no separate API origin / proxy in the default path). |
| **Target**  | Same Next app remains the UI + HTTP deploy unit on managed data plane; platform goal is Cloudflare Workers.                                          |

Direction and prohibitions: [Cloudflare fullstack refactor guidance](../docs/cloudflare-fullstack-refactor-guidance.md). Product bans remain in [AGENTS.md](../AGENTS.md).

**While evolving toward Workers:**

- Do not assume a permanent private `api` service or rebuild features that require
  a second public API origin. Legacy `archive/apps/web` proxy + Hono is comparison
  only.
- Do not collapse domain/server modules into client components just because deploy
  units already merged.
- Prefer same-origin API access patterns (`/api/*` via `lib/` helpers).
- Media: public objects may use public R2 domain URLs; personal uploads remain in
  scope (private + presigned or equivalent)—do not ship “upload disabled” as the
  target product stance.
- Label stubs honestly when a flow is incomplete; do not imply backend persistence
  that is not implemented.

## Composition and dependencies

- Routes and layouts deliver and compose pages; business-capability behavior
  stays with its owner. Framework-required routes may compose feature page
  implementations and application shells; this exception does not make those
  private implementations public to other features.
- Application composition may consume generic UI, infrastructure, constants, and
  feature public entries. Ordinary features must not depend on application
  composition implementation. Generic UI must not depend on features or
  application composition; non-UI infrastructure must not import UI components.
- Follow established server-state, cache, and UI-state patterns. Client UI state
  must not become an independent API/server source of truth. Preserve affected
  mutation, cache-refresh, pending, error, and interaction behavior; do not add
  a parallel state-management dependency without demonstrated need.
- Form policy and cross-boundary contracts come from `client/shared/` public
  modules (`@/shared/<module>`); do not redefine authentication bounds or DTOs in
  feature code. See [package rules](packages.md) when changing these contracts.

## Client security and authentication

- Navigation, cookie-presence checks, and client session gates are UX controls.
  Protected data and actions require backend authorization.
- Check the authenticated session and shared role policy before rendering admin
  content, and retain backend protection for its data and actions.
- Preserve established session-expiry/unauthorized behavior. Sign-out must clear
  applicable web-origin session cookies and invoke backend session invalidation;
  do not replace it with a local UI-state reset.

## Design and truthful interaction

- Read [DESIGN.md](../DESIGN.md) before UI creation, restyling, or review. It owns
  visual tokens, interaction philosophy, UI/product boundaries, system UI
  language, information economy, and admin density. Preserve its responsive,
  keyboard-access, and accessible-name requirements.
- Small copy, state, spacing, or existing-component layout fixes may proceed
  directly with impact-matched checks. For major pages, navigation, core flows,
  or new interaction patterns, confirm requirements, design direction, core
  interactions, and acceptance criteria before implementation; use an approved
  visual reference or prototype where needed. Design tools are task-dependent.
  Validate implemented changes on real pages across relevant viewports and states
  in proportion to their impact; small fixes do not require full browser E2E.
- Use semantic design tokens and existing UI primitives. Prefer their variants
  and composition before bespoke controls; do not introduce a parallel control
  system. Changes to shared primitive source require task authorization and
  review of affected consumers. Component installation methods belong to the
  applicable Skill and current configuration.
- Visual simplification does not authorize a change to persistence, automatic
  actions, confirmation, or navigation. Design-tool and Skill output must conform to
  DESIGN.md and the authorized product behavior, without adding dependencies.
- Label static/mock/UI-only functionality as prototype or stub in source and
  user-facing system-language copy. Do not imply saving, publishing, sync, or
  backend integration until the actual flow exists and is verified.
