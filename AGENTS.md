# AGENTS.md

Shared instructions for agents working in Gloaming. Read only the documents and
Skills selected by the task route below; `docs/` is product/engineering evidence,
not an always-on AI-rule directory.

`AGENTS.md` owns cross-agent hard boundaries and task routing. Path rules own
project-specific implementation constraints; Skills own reusable methods; product
and engineering documents own task-relevant facts.

## Product and domain boundaries

Gloaming is an AI-native English reading environment: authentic reading with
contextual AI when needed, not a course, drill product, or chatbot. Read
[`docs/product/README.md`](docs/product/README.md) only for product or feature
decisions, then follow its relevant document route.

Before schema work, or API work that creates or changes a public contract for
reading content, state, assets, or conversations, read the [domain
SSOT](docs/adr/001-reading-content-domain-model.md) and [engineering
vocabulary](docs/product/engineering-vocabulary.md). Such work targets
`ReadingWork`, `ReadingPart`, `ReadingState`, `ContentAsset`, and `Conversation`
with `subject_type = reading_work`.

Do not extend legacy `Article`, introduce Article compatibility aliases or dual
models, add `reading_progress` or `article_audio`, add lesson/course/Learn*
entities, or make Short Article Library the product identity. `admin_epub` is
the MVP supply; `admin_text` is internal development/test fallback only.

## Project hard boundaries

- Never commit secrets, `.env`, or local `docker-compose.yaml`; expose server
  secrets to clients; operate on production data; or disable security middleware.
- Do not start `dev:*`, `start`, or `preview`; push changes; add dependencies;
  delete files/directories; or change authentication, root/package configuration,
  or an existing-data schema without explicit user approval.
- `apps/web` and `apps/backend` never import each other's source. Both may use
  `@gloaming/shared`; only `@gloaming/db` owns Drizzle schema and migrations.
  `@gloaming/shared` has cross-app contracts/policy, never ORM, secrets, or
  business workflows.
- For cross-layer work, change the owning layer before its consumers: database
  schema → backend → tests → web; shared public contract → backend and web.
  Keep facts in one owner; import or derive them rather than copying them.
- Automated tests and agent database writes may target only `gloaming_test`. If
  `TEST_DATABASE_URL` or its target is missing or unclear, stop; never fall back
  to the development database. Cleanup must be limited to data created by the test.

## Task start gate

For a non-trivial change, before the first edit: identify the target paths and
operation, load the applicable path rule and only the necessary Skill(s) and
fact document(s), then state that loaded set in the plan or first progress
update. Repeat this gate after a material scope change or handoff. Do not claim
a rule, Skill, or document was read unless it was actually opened.

For architecture or repository-structure work, also declare the current phase:
investigation, decision, implementation, or verification. Keep confirmed facts,
confirmed decisions, open decisions, non-goals, and completion criteria separate.
Do not implement during investigation, turn an open decision into a non-goal,
or declare a partial migration complete. Architecture-level changes require an
explicit decision gate before implementation; an AI-generated prompt or draft
ADR cannot silently close that gate.

Draft or proposed ADRs are evidence and proposals, not active project policy.
When rules are changed in the working tree but code has not migrated, report
the rules as target intent and the code as current reality; do not silently
choose either side. A governance task is not complete merely because a rule
file changed: its stated failure scenario must also pass a read-only dry run.

## UI boundary

For UI work, `DESIGN.md` owns visual tokens, interaction philosophy, and the
UI-versus-product-behavior boundary. Use semantic variables from
`apps/web/app/globals.css`; visual simplification never implies persistence,
auto-save, automatic fetch, confirmation, or navigation.

## Skill management

Skills installed into this project are vendor-managed dependencies: install,
update, and remove them only with `npx skills`; their source and version are
recorded in [`skills-lock.json`](skills-lock.json) and their project-local copies
live in `.agents/skills/`. When a task route names a project Skill, use that
project-local copy rather than assuming a global Skill path. Do not edit bundled
Skill files. `npx skills check` may mutate or access the network, so run it only
with user approval. Global Skills remain user-environment dependencies.

## Task route

| Task signal                                                              | Read or load                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-trivial implementation or repository decision                        | `codebase-guardrails`                                                                                                                                                                                                                 |
| `apps/backend/**`                                                        | [backend.mdc](.cursor/rules/backend.mdc); add domain SSOT + vocabulary only for schema or content-domain public API work                                                                                                              |
| `apps/web/**`                                                            | [frontend.mdc](.cursor/rules/frontend.mdc); add `DESIGN.md` for UI creation, visual change, or interaction work; add a product flow only when flow, IA, or product behavior changes; at most one visual Skill when polish is in scope |
| `packages/**`                                                            | [packages.mdc](.cursor/rules/packages.mdc); add domain SSOT + vocabulary only when a shared content-domain public contract changes                                                                                                    |
| Database writes, migrations, seeds, integration/functional tests         | `test-database-workflow` plus this file's test boundary                                                                                                                                                                               |
| Add, delete, split, move, promote, or assess an overloaded code unit     | `.cursor/rules/repository-structure.mdc`, `repository-structure`, plus the applicable path rule                                                                                                                                       |
| Deployment, containers, environment, runtime diagnosis                   | `infrastructure-operations` plus repository configuration                                                                                                                                                                             |
| Named-symbol change, cross-module exploration/refactor/complex debugging | matching global GitNexus Skill when available                                                                                                                                                                                         |
| Product scope or feature decision                                        | only the relevant document under `docs/product/` or `docs/adr/`                                                                                                                                                                       |

## Instruction and evidence authority

1. System, security, permission, and explicit user-authorization boundaries.
2. The user's explicit goal, scope, and limits.
3. Locked task behavior and product/domain contracts.
4. This file and applicable path rules; for UI, `DESIGN.md` then `frontend.mdc`.
5. The selected Skill, then framework/component defaults and assumptions.

Code/configuration/tests/runtime are factual evidence. Lint, formatting,
typechecks, tests, and builds verify an implementation; they do not decide
product semantics. Official docs, MCP, and Skills provide external facts or
guidance, but never override project contracts. If sources conflict, report the
mismatch and ask rather than silently choosing. A user may change an ordinary
product preference, but a request that conflicts with a locked product or domain
contract requires an explicit decision before implementation.

## GitNexus

Use GitNexus only when its MCP or CLI is available and its index is current;
verify material graph conclusions against source. Before a named-symbol edit,
obtain impact analysis; before a commit, obtain a complete graph-change check.
High, critical, unknown, stale, partial, or truncated results are not an
all-clear. If unavailable, state the limitation and perform source/call-site
review, relevant tests, and an explicit manual-impact statement.

## Language

- Reply and present plans in Chinese when the user writes Chinese.
- Code comments, identifiers, and commits are English.
- Repository documentation is English unless the user requests another language.
