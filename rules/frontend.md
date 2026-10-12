# Web and UI

Discover current routing, state, authentication, components, and configuration
from the affected application. Do not prescribe a new library from a remembered
stack. For module ownership or public entries, read
[architecture rules](architecture.md).

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
- Form policy and cross-app contracts come from their owning shared public
  modules; do not redefine authentication bounds or DTOs in the web application.
  See [package rules](packages.md) when changing these contracts.

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
- Use semantic design tokens and existing UI primitives. Prefer their variants
  and composition before bespoke controls; do not introduce a parallel control
  system. Changes to shared primitive source require task authorization and
  review of affected consumers. Component installation methods belong to the
  applicable Skill and current configuration.
- Visual simplification does not authorize a change to persistence, automatic
  actions, confirmation, or navigation. Visual Skill output must conform to
  DESIGN.md and the authorized product behavior, without adding dependencies.
- Label static/mock/UI-only functionality as prototype or stub in source and
  user-facing system-language copy. Do not imply saving, publishing, sync, or
  backend integration until the actual flow exists and is verified.
