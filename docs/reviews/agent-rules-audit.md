# Agent Rules Audit

- Date: 2026-10-12
- Branch: `dev-02`
- Base HEAD checked: `92bb1f58f463ed5b90619d2b3dbfa57f89e6ab8d`

## Scope and active sources

This audit covers instructions that apply to the current checkout, relevant
Skills, host-level instructions, and current tool surfaces. Project documentation
and historical reviews were treated as evidence, not automatically as policy.

| Source                                                                                                       | Status and scope                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/Users/joyzhao/.codex/AGENTS.md`                                                                            | **ACTIVE / external**. Applies across this host; requires a matching delegation Skill for bounded work and leaves scope, authorization, review, and acceptance with the caller. Not changed. |
| `AGENTS.md`                                                                                                  | **ACTIVE / repository-wide**. Cross-agent boundaries and task routing. Updated in this audit.                                                                                                |
| `.cursor/rules/backend.mdc`, `frontend.mdc`, `packages.mdc`                                                  | **ACTIVE by routed path**. Front matter scopes them to their respective app/package paths; root `AGENTS.md` routes relevant work to them.                                                    |
| `.cursor/rules/repository-structure.mdc`                                                                     | **ACTIVE when routed** for structural decisions. Its workflow is the authority for those phases.                                                                                             |
| `.cursor/mcp.json`                                                                                           | **ACTIVE editor configuration** for its listed developer/documentation MCPs; it does not register Pi task dispatch.                                                                          |
| `.agents/skills/test-database-workflow/SKILL.md`                                                             | **ACTIVE when database-writing automated tests are involved**. Defines isolated test DB use and bounded cleanup. Not changed.                                                                |
| `.agents/skills/repository-structure`, `codebase-guardrails`, `using-git-worktrees` and global `pi-delegate` | **METHOD / conditional**. Reusable procedures selected by task, not a second project-wide policy file. Skills were not modified.                                                             |
| `.agents/skills/vercel-react-best-practices/AGENTS.md`                                                       | **SCOPED** to that bundled Skill's material, not an instruction for all application code.                                                                                                    |
| `.worktrees/*/AGENTS.md`                                                                                     | **SCOPED** to their separate worktrees; they do not apply to this checkout.                                                                                                                  |
| `docs/reviews/user-first/public-categories-execution-plan.md`                                                | **REFERENCE / task-specific**. It documents Codex-managed worktrees with Pi running directly inside one, but does not establish a standing repository rule.                                  |
| `docs/**`, old reviews, and proposed design records                                                          | **REFERENCE** unless a task route explicitly selects one as product or engineering evidence. No historical dispatch protocol was promoted to active policy.                                  |

Current tool surfaces include the Pi task-execution MCP and Codex worktree
tools. No project-owned Scheduler or dispatch rule file was found. Codex
automation scheduling is host-level and is not a project dispatch rule. The
installed `pi-delegate` Skill is the current Pi procedure;
the active contract exposes `pi_list`, `pi_spawn`, `pi_status`, `pi_continue`,
`pi_steer`, and `pi_abort`. No legacy Pi CLI/MCP invocation was found in the
repository's active rule files.

## Findings and dispositions

| Status               | Finding and disposition                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FIXED**            | `AGENTS.md` previously said automated tests **and all agent database writes** could target only `gloaming_test`. This wrongly grouped routine development writes and migrations with automated tests. The rule now separates test, development, production, and destructive-operation boundaries.                                                                                                                                        |
| **FIXED**            | The root task-start gate listed architecture phases as investigation/decision/implementation/verification, while `repository-structure.mdc` uses investigate/decide/plan/implement/verify. The root now delegates that workflow to its owning rule.                                                                                                                                                                                      |
| **FIXED**            | The root task route previously loaded the test-database Skill for all database writes, migrations, and seeds. It now routes only automated tests that write a database to that Skill, so a development migration is not accidentally treated as a test write.                                                                                                                                                                            |
| **FIXED**            | Root rules did not provide a minimal project boundary for delegated execution. Added supervisor ownership, worker scope, assigned-worktree isolation, handoff evidence, and supervisor-controlled integration/cleanup without encoding tool parameters.                                                                                                                                                                                  |
| **FIXED**            | The generic worktree Skill allows a fallback to the current directory if setup is blocked. The project rule now makes Pi's assigned isolation a hard boundary and requires stopping if it is unavailable.                                                                                                                                                                                                                                |
| **FIXED**            | Root rules prohibited starting all `dev:*`, `start`, and `preview` services without a clear local-verification path. Local services are now allowed when requested for development/verification with the intended local environment; production targets remain separately protected.                                                                                                                                                     |
| **KEPT**             | Test isolation remains strict. Backend `env-common.ts` applies the guard when `VITEST=true`, requires `TEST_DATABASE_URL`, checks the database name equals `gloaming_test`, and pins `DATABASE_URL` to the verified test URL. Missing or invalid targets fail closed.                                                                                                                                                                    |
| **KEPT**             | Secrets, auth boundaries, security middleware, production data, explicit approval for existing-data schema changes, destructive-operation authorization, and no-push/no-dependency/no-delete boundaries remain protected. Independent platform/tool approval is unaffected.                                                                                                                                                              |
| **KEPT**             | Path ownership rules, shared-package boundaries, UI design source, and routed project Skills remain in their existing owners. No unrelated engineering rule was rewritten.                                                                                                                                                                                                                                                               |
| **KEPT**             | `.husky/pre-commit` runs `lint-staged`; `.husky/pre-push` runs typecheck, lint, format check, and the repository test suite. These are hook behaviors, not a requirement to run all checks after each focused change. No hook was changed.                                                                                                                                                                                               |
| **REMOVED**          | Removed the blanket phrase restricting every agent database write to `gloaming_test`, the duplicate root architecture-phase list, and the overly broad task-route association between normal migrations and the test-database Skill.                                                                                                                                                                                                     |
| **NEEDS_DECISION**   | None for the repository-rule changes in this scope. The generic test Skill has a broad sentence (“before any database write”), but its front-matter and title scope it to integration/functional tests; root routing now makes that boundary explicit. If that wording continues to block non-test work, update the vendor-managed Skill through its supported management process in a separate task.                                    |
| **EXTERNAL_BLOCKER** | The existing PC-07 acceptance record reports that the prior `gloaming_backend` migration attempt was rejected by automatic approval review, citing both the old AGENTS restriction and schema risk, and instructing not to bypass the rejection (`docs/reviews/user-first/public-categories-implementation.md:72`). This audit fixes the project-rule cause; it does not change independent review. No retry or migration was attempted. |

## Database rule conclusion

`gloaming_test` is required for automated tests that write a database because
test setup, fixtures, migrations, and cleanup must be isolated from normal and
production data. The runtime guard makes backend Vitest fail closed rather than
falling back to `gloaming_backend`.

Normal local development, API debugging, manual functional/browser acceptance,
and routine development-data changes may use a confirmed `gloaming_backend`
target under ordinary auth/data boundaries. Development migrations require a
confirmed target and migration state; existing-data schema changes still need
explicit user authorization, and potentially destructive changes need impact
review and a backup. Production work requires separate explicit authorization
naming the target and operation, plus any independent platform approval.

The project-level blocker was the old root sentence “Automated tests and agent
database writes may target only `gloaming_test`.” The existing PC-07 record also
identifies the immediate rejection source: automatic approval review rejected
that migration based on this project rule and schema risk. The project rule is
now corrected; the independent reviewer can still require its own approval for
a future migration. No alternate tool or indirect route was used.

## Delegation and worktrees

The minimum repository policy now keeps scope, risk, authorization, integration,
and acceptance with the supervisor; delegates through currently available tools
and Skills; and grants no extra authority to a worker. A Pi implementation
worker runs in its assigned isolated worktree, stops if that isolation is
unavailable, reports actual edits/checks/Git state/open issues, and does not
integrate or remove an unmerged worktree. The supervisor controls integration
and cleanup.

No single worktree path is currently authoritative: the inspected checkout has
worktrees under `.worktrees/`, `.pi-task-exec/worktrees/`, and the Codex-managed
`~/.codex/worktrees/`. `.worktrees/` is ignored and is the generic Skill's
fallback location. Pi MCP `worktree` mode uses `.pi-task-exec/worktrees/`, which
is not ignored; the Skill's project-local fallback ignore check therefore does
not describe that MCP-managed path. The task-specific PC-07 plan instead used a
Codex-managed worktree with Pi `direct` inside it. The root rule leaves location
to the manager and requires an assigned isolated workspace, supervisor-owned
integration, and safe cleanup. Existing worktrees and untracked directories were
left untouched.

## Test and acceptance strategy

The updated rule separates focused feature checks, module/flow integration
acceptance, and release verification. Full test suites, browser/Worker E2E, and
paid AI calls are reserved for acceptance stages where relevant. Schema, authorization,
cross-user isolation, transaction, idempotency, and security-boundary changes
still need risk-relevant tests during implementation. The pre-push hook remains
the current full verification gate.

## Read-only scenario dry run

| Scenario                                                                            | Rule result                                                                                                                                                            |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01. A database-writing automated unit/functional/integration test runs              | **PASS** — use verified `TEST_DATABASE_URL` targeting `gloaming_test`; test writes and cleanup stay isolated.                                                          |
| 02. Codex debugs a development API                                                  | **PASS** — confirmed local `gloaming_backend` is allowed under normal application authorization/data boundaries.                                                       |
| 03. User authorizes a development migration                                         | **PASS** — confirm target and migration state; existing-data schema change has explicit authorization; no AGENTS rewrite is needed. Tool approval remains independent. |
| 04. Agent attempts a production migration without explicit production authorization | **BLOCKED** — target/action authorization and any platform approval are required.                                                                                      |
| 05. Test DB connection is missing or wrong                                          | **BLOCKED** — stop; the backend test guard rejects it and does not fall back to development.                                                                           |
| 06. Codex delegates feature implementation to Pi                                    | **PASS** — use the current Pi MCP/Skill; supervisor retains scope/authorization/review; worker gains no extra permissions.                                             |
| 07. Pi works in its assigned worktree                                               | **PASS** — assigned isolation applies; if unavailable, stop; no main-checkout edits or worker merge; mechanics/path come from the active tool/Skill.                   |
| 08. Ordinary UI component changes                                                   | **PASS** — use impact-matched focused checks; no blanket browser E2E requirement.                                                                                      |
| 09. Database constraint or authorization logic changes                              | **PASS** — run risk-relevant schema, permission, isolation, transaction, or security tests during implementation, using the test DB for automated writes.              |
| 10. An unmerged worktree is considered for removal                                  | **BLOCKED until reviewed** — supervisor checks for unmerged/unsaved work and owns cleanup; workers do not remove it.                                                   |
| 11. A real paid AI call is proposed                                                 | **BLOCKED until authorized** — confirm expected cost and explicit authorization first.                                                                                 |
| 12. User requests local functional acceptance                                       | **PASS** — local services may start as needed with the intended local environment; do not target production.                                                           |

This dry run verifies rule text only. It does not claim that external approvals,
tool permissions, credentials, or service availability have changed.

## Files changed and Git state

- **Modified:** `AGENTS.md`
- **Added:** `docs/reviews/agent-rules-audit.md` (this report)
- **Not changed:** business code, database schema/migrations, test implementation,
  Skills, hooks, tool configuration, global instructions, or existing worktrees.
- No commit or push was made. Existing user changes remain untouched: the
  modified `docs/reviews/user-first/public-categories-implementation.md` and
  untracked `.pi-task-exec/` and `.playwright-mcp/` directories.
