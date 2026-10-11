# Public Categories — Execution Plan

**Status:** investigation and task plan only. No Public Categories code, schema, migration, AI call, or database operation was performed. Product/category choices marked open below need approval before implementation.

## Git baseline and frozen scope

- Branch: `dev-02`; HEAD: `b22e7c4bef85ec19b21e42ebd7d5fdb56754100a` (`feat(tags): tighten P2 classification validation`). It contains the five reviewed Personal Tags P2 files; local commit hooks ran ESLint and Prettier successfully. No push was made.
- The P2 commit left `dev-02` 22 commits ahead of `origin/dev-02`; the separate plan-document commit followed it. The prior commits were not rewritten or pushed.
- Personal Tags P1/P2 are frozen. Worker E2E and reliability/ quota follow-up remain Watchlist items. No unrelated Settings Model, Provider, or real-model work is included here.
- GitNexus was 43 commits behind and returned stale symbols. Its results were not used as an all-clear; current source, call sites, route absence specs, and migration 0041 were checked manually.

## Current state

There is **no Public Category model or category assignment in the current schema/API/UI**. Migration 0041 dropped the old global `category`, `tag`, `reading_work_category`, and related tables. Current personal tables remain user-owned and are not a reusable public taxonomy.

Reusable foundations:

- `SourceRecord` has source-scoped identity `(source_id, external_id)`, raw metadata, and an optional `work_id` link. Gutenberg parsing stores raw `subjects` and `bookshelves` in `sourceMeta`; snapshot sync upserts those source-owned fields.
- Backend already has a public SourceRecord list/detail API (`GET /api/discover/records`) with availability/source-enabled checks, search, language, sorting, and pagination, plus a shared discovery DTO.
- General structured AI invocation, invocation auditing, and Provider Resolver are available. Metadata enrichment currently fills ReadingWork description; it is not source classification. AI/public-provider scope and cost ownership still need a decision.
- `packages/i18n` supports `zh-CN` and `en-US`; no Public Category labels or Discover category strings exist.

Current Discover has two separate paths. The learner-facing web page calls `GET /api/catalog/works`, which lists published ReadingWorks; it does not call the SourceRecord endpoint and has no category filter. SourceRecord list/detail routes exist without a Web consumer. Materialized Gutenberg Works are created unpublished (`published_at = NULL`), and no current runtime flow publishes them, so the two paths do not currently form a single visible Gutenberg-to-Discover flow.

Stable identities are distinct: `ReadingWork.id` identifies readable content. A SourceRecord is identified locally by its `id` and upstream by `(source_id, external_id)`; its optional `work_id` links to a materialized ReadingWork. The current unique `work_id` constraint permits at most one SourceRecord per Work, so cross-source work aggregation is not implemented.

## Category ownership recommendation (open decision)

**Recommendation: attach Public Category assignments to `SourceRecord`.** The source record owns raw subject evidence, exists before EPUB materialization, and already has a public read model. This lets a category exist before a Work is downloaded and keeps private Personal EPUBs and User Tags outside public classification. It also follows the source-owned metadata boundary.

Schema/API consequence if approved: add a controlled public category and localized-label model plus a many-to-many SourceRecord assignment (stable category ID, source/provenance evidence, uniqueness/idempotency); extend the SourceRecord DTO/read model and category query. Do not duplicate assignments onto ReadingWork. If a Work detail needs category display, derive it through the existing link. The alternative, Work ownership, would require Work-category storage and filtering only published Works; it cannot classify unmaterialized records and would leave the existing SourceRecord directory without categories.

This is a recommendation only. `SourceRecord` vs `ReadingWork` remains OPEN in `ai-labeling-contract.md`. That same contract is a review draft, not an implementation authorization. Older design-study recommendations do not close this gate.

## Proposed tasks

All paths below are candidate write boundaries for future, separately authorized tasks. The first task cannot start until the open identity and Discover presentation decisions are confirmed.

| Task                                                     | Objective, scope, likely paths, and deliverable                                                                                                                                                                                                                                                                                                                                                                           | Depends on / acceptance                                                                                                                                                                                                                         | Parallel / Pi                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **PC-01 — Category foundation and shared contract**      | Add the approved flat category and localized-label schema, SourceRecord assignment constraints, and shared discovery DTO/query shapes. Candidate paths: `packages/db/src/schema.ts`, next `packages/db/migrations/**`, `packages/shared/src/discovery/**`, `packages/i18n/src/messages/{en-US,zh-CN}.json`. Deliver: schema/migration source, stable contract, focused constraints/DTO tests; do not apply the migration. | Requires approved category owner and Discover identity. Stable IDs and localized names; no tree, User Tag reuse, or generic taxonomy framework.                                                                                                 | Serial first. Suitable for a Pi implement Worker in its own Worktree after decisions. |
| **PC-02 — Discovery classification domain and read API** | Add Discovery-owned category persistence/service, deterministic mapping from known source terms, and category projection/filter to SourceRecord read routes. Candidate paths: `apps/backend/src/domains/discovery/**`, `packages/shared/src/discovery/**` only if PC-01 review requires a contract correction. Deliver: bounded service/API plus unit and `gloaming_test`-only functional coverage.                       | Depends on PC-01. Raw source metadata stays intact; unknown terms do not become categories; duplicate associations are prevented; the category-filtered read result is paginated and localized.                                                 | Serial after PC-01. Pi implement Worker. Keep Web and AI files out of scope.          |
| **PC-03 — AI decision and restrained creation**          | Add a Public Category decision schema/prompt/validator and Discovery command using existing `invokeAi` and Provider Resolver; reuse/abstain before create, preserve labels, make create/link idempotent. Candidate paths: new `apps/backend/src/domains/discovery/**` category files and the narrow AI purpose/resolver contract only if approved. Deliver: pure decision tests and bounded mocked-provider/domain tests. | Depends on PC-01 and PC-02 service interface. Must follow the recorded `REUSE / CREATE / NO_MATCH / NEEDS_REVIEW` contract; do not call real paid AI in Worker checks. Provider scope, spend owner, and auto-create threshold require approval. | Can run alongside PC-04 after PC-02, with disjoint paths. Pi implement Worker.        |
| **PC-04 — Discover filter and display**                  | Consume the approved category DTO/query, show localized category labels, and preserve category selection through pagination/search. Candidate paths: `apps/web/features/discover/**`, plus category UI messages if not completed in PC-01. Deliver: focused API/query and component tests.                                                                                                                                | Depends on PC-01 and PC-02. Must use the approved Discover identity and keep Library membership/reading actions attached to the correct Work or SourceRecord link. No visual redesign beyond the needed filter/display.                         | Can run alongside PC-03 after PC-02. Pi implement Worker.                             |
| **PC-05 — Incremental classification trigger**           | Trigger classification only for new or materially changed eligible SourceRecords after successful sync/enrichment, with bounded retries and no search/render-time AI. Candidate paths: `apps/backend/src/domains/discovery/sync/**`, `apps/backend/src/application/jobs/**`, and the owning queue registration. Deliver: idempotency/retry tests and a documented no-full-corpus-reprocess guard.                         | Depends on PC-03. Keep source sync browseable if AI/provider fails; preserve raw metadata. Decide exact change detection and retry/budget policy before dispatch.                                                                               | Serial after PC-03; keep PC-04 independent. Pi implement Worker.                      |
| **PC-06 — Integration and acceptance**                   | Codex reviews all diffs, resolves conflicts, merges tasks serially, and runs the consolidated regression and user-facing acceptance. Deliver: reviewed merge commits and an evidence-based acceptance report.                                                                                                                                                                                                             | Depends on PC-01–05. No Worker merges or pushes. Run tests only on `gloaming_test`; real AI, browser acceptance, and Worker E2E happen once at the end under separately approved limits.                                                        | Supervisor-owned; do not delegate final acceptance.                                   |

### Dependency and parallel schedule

```text
User decision gate
  → PC-01
  → PC-02
  → ┌─ PC-03 → PC-05 ─┐
    └─ PC-04 ──────────┴→ PC-06
```

Use at most two concurrent implementation Workers: PC-03 and PC-04. Do not parallelize schema/DTO changes with consumers. Merge one task at a time; every dependent Worktree starts from the exact accepted merge commit, not a dirty primary checkout.

## Pi, Worktree, and merge protocol

- Current connected delegation skill is `pi-delegate` v4 and the registered MCP is `mcp__pi_task_exec__*`: `pi_list`, `pi_spawn`, `pi_status`, `pi_steer`, `pi_continue`, `pi_abort`. Use `pi_spawn` with a bounded task and `profile: implement`; inspect/release results with `pi_status` and `pi_abort`. `pi_continue` only reuses a related worker while that MCP server still holds its live `workerId`; workers run with `--no-session`, so IDs do not survive an MCP restart/reconnect. The current fleet was empty before investigation.
- Pi `mode: worktree` creates a `pi-task-exec/<id>` branch under `<cwd>/.pi-task-exec/worktrees`; this appears as untracked content in the parent checkout. The read-only investigation confirmed that behavior. To keep `dev-02` clean, prefer one Codex-managed task Worktree per task, based on the exact accepted commit, then run the Pi Worker with `mode: direct` **inside that isolated Worktree**. First confirm that Pi's allowed roots admit the returned path; never fall back to the primary checkout. The Codex Worktree tool is available, but this run did not create an implementation Worktree.
- Each task gets its own branch/Worktree and explicit file boundary. Workers report branch, Worktree path, commit SHA, changed files, checks, and unresolved items. They do not merge, push, reset, clean, or remove another Worktree. Codex independently reviews scope and output, runs focused checks, and merges serially.
- PC-01 starts from the current clean plan baseline (`c979f71e…`); `b22e7c4b…` is the immediately preceding P2 code commit. Later tasks start from the exact merge commit that contains their dependencies. Resolve conflicts only in Codex's integration step. Do not run full integrated acceptance for each Worker.

## Verification policy

During implementation, use focused pure unit tests for validators/mapping/DTOs and narrowly scoped functional tests only against `gloaming_test`. A missing or unclear `TEST_DATABASE_URL` blocks database-backed checks; never fall back to development data. Do not run migrations against any database in a Worker task. Review migration source and generated schema snapshots statically.

After PC-01–05 are integrated, run the backend/shared/web relevant regression suites once, then do the approved real-AI sample set, browser Discover acceptance, and Worker E2E once. Record failures and usage honestly; a connectivity check is not classification acceptance.

## Required decisions before PC-01

1. Approve or reject SourceRecord category ownership. If approved, confirm the Discover identity transition: should the learner-facing Discover list SourceRecords and derive linked Work actions, or remain ReadingWork-only?
2. Confirm the first-release category scope/seed policy. The current contract supports an empty cold start; older study dimensions and suggested seed lists are not approved by this plan.
3. Confirm who owns public AI usage cost and which Provider scope/purpose it must resolve to. Personal Tags' user-only Provider behavior must remain unchanged.
4. Confirm the initial auto-create cap/retry policy and whether public labels need an operator review surface in this phase. A full taxonomy CMS, category tree, cross-source Work deduplication, and corpus-wide AI reclassification are out of scope.

## Estimate

Six tasks total: five implementation tasks plus one integration/acceptance task. After the decision gate, expect **four merge rounds**: PC-01; PC-02; PC-03 and PC-04 in parallel but merged serially; PC-05. Then one consolidated PC-06 acceptance round. This estimate assumes the Discover identity decision does not require a separate architecture migration.
