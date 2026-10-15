# Gloaming Agent Instructions

These instructions apply across the repository. Read applicable detailed rules
and Skills according to the task. Project documents provide context and decision
evidence; they are not automatically loaded rules or a prerequisite for ordinary
development.

## Project

Gloaming is an AI-native environment for authentic English reading with
contextual AI support. Do not revive legacy `Article` models, aliases,
`reading_progress`, `article_audio`, or lesson/course entities, or redefine the
product as a Short Article Library. Keep web and backend source separate;
cross-app contracts belong in `@gloaming/shared`, and database schema belongs
in `@gloaming/db`. When changing persistent domain models or public contracts,
identify the current authoritative model, preserve established invariants, and
verify affected producers and consumers. Do not change core business semantics
without task authorization.

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
  Orca manages task worktree creation, registration, and cleanup. Use the
  applicable Orca Skill and supported tools for these operations. Agents reuse
  the assigned workspace; do not create additional worktrees through Codex,
  other platforms, or raw Git without explicit user authorization. If Orca
  cannot safely provide the required isolation, stop and report. A safety or
  permission refusal must not be bypassed.
- Reuse a suitable assigned isolated workspace before requesting another.
  Confirm the actual path, project/task ownership, lifecycle manager, work
  preservation and recovery, and safe cleanup mechanism. Before creation,
  verify the target repository, intended base ref, branch state, worktree
  registration, and isolation; verify ignore protection for project-local
  directories. Failed safety checks mean
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

## Project instructions

Detailed project rules are maintained in the project-owned `rules/` directory.
Read only the rules relevant to the current task:

- Backend services and APIs: [backend rules](rules/backend.md).
- Web and UI: [frontend rules](rules/frontend.md) and, for UI work,
  [DESIGN.md](DESIGN.md).
- Shared packages and contracts: [package rules](rules/packages.md).
- Module ownership, public boundaries, or major structural changes:
  [architecture rules](rules/architecture.md) and the relevant Skill.
  Follow their decision boundaries for architectural changes; do
  not impose it on ordinary local edits.

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
