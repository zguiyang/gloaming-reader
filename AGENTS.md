# Gloaming Agent Instructions

These instructions apply across the repository. Read applicable detailed rules
and Skills according to the task. Project documents provide context and decision
evidence; they are not automatically loaded rules or a prerequisite for ordinary
development.

## Project

Gloaming is an AI-native environment for authentic English reading with
contextual AI support. Do not revive legacy `Article` models, aliases,
`reading_progress`, `article_audio`, or lesson/course entities, or redefine the
product as a Short Article Library.

**Live product is the repository root** — a single Next.js package (UI + `/api/*`
Route Handlers + optional `jobs/` worker). Cross-boundary contracts live in
`shared/` (import `@/shared/*`); i18n in `i18n/` (`@/i18n`); database schema in
`server/db`.

Logical server-domain boundaries remain even when the deploy unit is a single
Next app. When changing persistent domain models or public contracts, identify
the current authoritative model, preserve established invariants, and verify
affected producers and consumers. Do not change core business semantics without
task authorization.

## Deploy and API topology

| State       | Meaning                                                                                                                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Current** | Single-package Next app at repo root (UI + `/api/*`) + optional same-package `jobs/` worker.                                                                                                                                                                                                            |
| **Target**  | Same app shape on a conventional Node host (e.g. VPS): typically **app** (Next, optionally behind Nginx) + **jobs**; data plane on managed Postgres / Redis / object storage. Cloudflare may front the host for DNS, TLS, and CDN (orange-cloud proxy) — **not** Cloudflare Workers as the app runtime. |

**Do not**:

- Treat nested Hono-in-Next as the final API architecture (Hono is not in the live tree)
- Restore `web+api+worker` three long-lived API services as the recommended open-source default (Jobs as a second process/container is fine)
- Revive Discover, `discovery_source` / `source_record` catalog sync, or Gutenberg ingest as a content path (library content is **personal upload only**)
- Default TTS/LLM onto Workers AI
- Treat personal upload as out of scope
- Equate deploy merge with collapsing domain logic into UI modules
- Reintroduce a multi-package pnpm workspace for the live product
- Reintroduce vinext / Workers deploy tooling or claim the product runs on Cloudflare Workers

Discover owners from current source at the repo root.

## Safety and data

- Work within the user's requested scope. Preserve unrelated and pre-existing
  user changes. Normal, reversible work within scope does not need repeated
  approval; pause when the target or impact is unclear, outside scope, sensitive,
  or difficult to reverse.
- Protect credentials and private data. Never expose server secrets to clients,
  commit secrets or `.env` files, or disable security middleware.
- **Automated tests:** Any automated test that writes persistent data must use a
  verified isolated test environment. If it cannot be confirmed, stop; never
  fall back to a development or production environment. Clean up only data
  created by the test. Use the [test database Skill](.agents/skills/test-database-workflow/SKILL.md)
  for its applicable workflow.
- **Development:** Local development, API debugging, routine development writes,
  interactive browser acceptance, and authorized development migrations may use
  a verified development environment under normal application authorization and
  data boundaries. Before migration, confirm the target and migration state;
  existing-data schema changes require explicit user authorization; assess
  data-loss risk and back up when needed. Treat repeatable browser E2E suites as
  automated tests; interactive browser acceptance may use the verified
  development environment.
- **Production:** Production data operations require explicit authorization for
  the target and operation. Development authorization does not extend to
  production; independent platform or tool approvals still apply.
- **Destructive actions:** Clear operations, broad data changes, and difficult-
  to-reverse changes require clear target, impact review, and explicit
  authorization. File changes or deletions that are clearly within the requested
  scope may proceed; protect user data and work outside that scope.
- Start local services only when needed for requested development or
  verification, with local configuration. Never point local work at production.

## Tools and Skills

- Use relevant Skills and available tools for execution details; do not copy
  their dispatch, session, model, parameter, or worktree procedures here.
  Skills do not override project authorization, safety, or accepted architecture
  and design decisions.
- The supervising agent decides whether isolation is needed, allocates the
  workspace, reviews results, integrates changes, and coordinates cleanup.
  Orca manages task worktree creation, registration, and cleanup when used. Use
  the applicable Orca Skill and supported tools for these operations. Agents
  reuse the assigned workspace; do not create additional worktrees through other
  platforms or raw Git without explicit user authorization. If isolation cannot
  be provided safely, stop and report. A safety or permission refusal must not
  be bypassed.
- Reuse a suitable assigned isolated workspace before requesting another.
  Confirm the actual path, project/task ownership, lifecycle manager, work
  preservation and recovery, and safe cleanup mechanism. Before creation,
  verify the target repository, intended base ref, branch state, worktree
  registration, and isolation; verify ignore protection for project-local
  epochs. Failed safety checks mean
  stop. Do not change ignore configuration or choose another unmanaged location
  without explicit user authorization.
- A delegated write task must use its assigned isolated workspace. Workers do
  not modify the shared main workspace, create or move worktrees, merge changes,
  or clean up workspaces. If isolation is unavailable, stop rather than fall
  back to shared work. Read-only investigation does not require a worktree.
- The supervisor coordinates cleanup only after the task is complete, its work
  is safely preserved, no uncommitted or important unintegrated work remains,
  and no other task is using the worktree. Use its managed Git lifecycle; do not
  delete a worktree directory directly.
- Delegation does not expand authorization. The supervising agent retains scope
  and risk decisions and checks the actual result before accepting it.
- Treat installed external Skills as managed dependencies. Do not edit their
  installed copies; use their supported source and update process.

## Verification and reporting

- Match checks to impact: focused checks during feature work, relevant
  integration acceptance when a flow or module is complete, and broader
  verification before release. Validate security-sensitive and data-integrity
  behavior during implementation. Do not require full-suite tests, browser E2E,
  or live AI calls for every change.
- Report what changed and what was actually checked. Distinguish implementation,
  automated test results, runtime acceptance, and anything still unverified.

## UI copy (mandatory)

- **NEVER** restate a title as a subtitle, hint, or description. If a card,
  section, dialog, or tab is already titled (e.g. “Voice settings”), forbid
  synonymous filler below it (e.g. “Configure your voice options here”).
- **NEVER** ship empty guidance: “Welcome to…”, “Adjust the parameters as
  needed”, “Here you can manage…”, or any equivalent AI filler.
- Helper / muted copy is allowed **only** for non-obvious constraints
  (format, size, etc.), irreversible warnings, or live status. Otherwise:
  title + controls only — no decorative prose.

## Project instructions

Detailed project rules are maintained in the project-owned `rules/` directory.
Read only the rules relevant to the current task:

- Deploy/API topology: this file’s
  [Deploy and API topology](#deploy-and-api-topology) section,
  [LOCAL_RUN.md](docs/LOCAL_RUN.md), and [deployment.md](docs/deployment.md)
  (live product = repo root single package; Node host + optional Cloudflare
  DNS/CDN — not Workers runtime).
- Backend services and APIs: [backend rules](rules/backend.md).
- Web and UI: this file’s [UI copy (mandatory)](#ui-copy-mandatory) section,
  [frontend rules](rules/frontend.md), and, for UI work, [DESIGN.md](DESIGN.md).
- Shared contracts and i18n: [package rules](rules/packages.md)
  (`shared/`, `i18n/`, `server/db`).
- Module ownership, public boundaries, or major structural changes:
  [architecture rules](rules/architecture.md) and the relevant Skill.
  Follow their decision boundaries for architectural changes; do
  not impose it on ordinary local edits.
- Local run and deploy narratives:
  [LOCAL_RUN.md](docs/LOCAL_RUN.md), [deployment.md](docs/deployment.md).
- Layout and import direction: discover from the repo-root tree and
  [package rules](rules/packages.md); do not maintain a separate layout map.
- Next.js may regenerate a short `AGENTS.md` notice block; product policy
  remains this file + `rules/` — do not treat framework notices as a second
  product rulebook.

Consult current source and configuration for implementation details. Use Skills
for operating procedures and tools for their capabilities and access checks.
Start from the user's requirements, existing implementation, relevant contracts,
tests, and explicit product constraints. Independently consult relevant project
documents when the task needs context, requirements are incomplete, or decision
evidence conflicts; read materials explicitly requested by the user. No routine
document loading or recursive document scan is required.

The applicable rules and accepted decisions define project intent. Source,
configuration, tests, and runtime show current behavior. If they materially
conflict, report the mismatch and avoid a risky assumption. Draft proposals are
not accepted decisions.

## Communication

When reporting, include relevant changes, checks, Git state, and unresolved
issues. Reply in Chinese when the user writes in Chinese. Keep code identifiers
and comments in English; write repository documentation in English unless
requested otherwise.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
