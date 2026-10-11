# Public Categories — PC-07 Final Acceptance

**Date:** 2026-10-11
**Branch:** `dev-02`
**Acceptance code baseline:** `b6ed65cf228a2c29261af61c468c2f50e0709858` (PC-07 admin candidate-search merge; this report is committed separately)

This is an evidence report, not a claim that every live acceptance gate passed. Status describes PC-07 acceptance evidence: **PASS** means verified for this scope; **PARTIAL** means implementation or tests exist but a live or guarded check is incomplete; **BLOCKED** means the required environment or access was unavailable; **NOT TESTED** means no check was attempted.

## PC-01–PC-06 status

| Task                                 | Status      | Evidence and remaining gap                                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PC-01 — Category foundation          | **PASS**    | Stable public category IDs, localized labels, SourceRecord assignments, and bounded assignment constraints are integrated. Migration source was reviewed in the implementation rounds; PC-07 ran no migrations.                                                                                                                    |
| PC-02 — Discovery service and API    | **PARTIAL** | Category service and SourceRecord read/filter APIs are integrated and were covered by earlier implementation checks. In the available browser runtime, `GET /api/discover/categories` returned HTTP 500, so current-runtime category browsing was not accepted.                                                                    |
| PC-03 — Public AI classification     | **PARTIAL** | Prompt, structured decision schema, server validation, instance Provider resolution, shared call budget, manual-assignment precedence, and suppression behavior are present. The latest locale-scope regression tests could not execute because the backend test guard requires `TEST_DATABASE_URL`; see test results below.       |
| PC-04 — Learner Discover             | **PARTIAL** | SourceRecord discovery, localized category filters, pagination/search state, and the unlinked published-Work compatibility path are implemented. The live page had no records and the category endpoint failed, preventing real filter and detail-flow acceptance.                                                                 |
| PC-05 — Instance category management | **PARTIAL** | Category list/search, manual creation, per-locale label editing, assigned-record search, explicit assign/remove, error handling, and admin route guards are implemented. PC-07 fixed candidate search to include non-public SourceRecords. An authenticated browser session and guarded backend functional tests were unavailable. |
| PC-06 — Incremental classification   | **PARTIAL** | New/material-change evidence, fingerprint idempotency, bounded retries, budget deferral, and manual/suppression protection have implementation and test coverage. Real Worker/Redis E2E was not run because an isolated test environment could not be confirmed.                                                                   |

## PC-03 latest locale fix

The final PC-03 fix scopes normalized-name collision handling to the record's source locale. Tests cover identical strings across different locales as distinct unless the model explicitly returns a semantic `REUSE`, exact same-locale collisions as stable-ID reuse, and cross-language semantic reuse through the model decision. These runtime assertions are **written but not executed**.

| Check                                 | Result                                                                                                                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused PC-03 unit test               | **BLOCKED** — `apps/backend/tests/setup.ts` requires `TEST_DATABASE_URL` even for unit specs. `apps/backend/.env.test` was absent and the environment variable was unset. The setup guard was not bypassed. |
| PC-03 functional test                 | **BLOCKED** — no verified `gloaming_test` target or test Redis configuration was available. Not run.                                                                                                        |
| Backend typecheck                     | **PASS** — existing `apps/backend/node_modules/.bin/tsc --noEmit` exited 0.                                                                                                                                 |
| Prettier on the three PC-03 fix files | **PASS** — Worker check exited 0.                                                                                                                                                                           |

One `pnpm` invocation refused to switch to the pinned package manager because registry signature verification fetches failed. No integrity check was disabled. A later Git hook successfully ran the repository's pnpm install check and reported the lockfile up to date.

## PC-07 admin candidate-search fix

PC-05 had searched candidates through the public Discover endpoint, which omitted unavailable records, disabled sources, and non-English records. PC-07 added `GET /api/admin/discovery/source-records`, guarded by `requireAdmin`, using the existing `SourceRecordListData` contract and Discovery read model. The admin query omits public visibility and language filters and reads SourceRecords only; private EPUB Works are not candidates. The UI now uses this endpoint and says its search includes records hidden from public Discover. No schema, migration, public route, or shared DTO changed.

The functional fixture is bounded to its unique run ID and restores only the source and record state it changes. It asserts that public Discover hides the non-English/unavailable records and all records of a disabled source while the admin list retains them. The anonymous/regular-user authorization matrix also includes the new route. These backend tests are **written but blocked** by the missing `gloaming_test` configuration.

The change passed backend and web typechecks, backend declaration emit, Shared tests (137), i18n tests (9), the Web suite (48 files / 304 tests), ESLint on changed TypeScript files, Prettier on changed files, and the pre-commit formatting/lint hook. The functional fixture and authorization matrix have not run.

After the serial merge, Codex reran the Web suite (**48 files / 304 tests passed**), Shared suite (**20 files / 137 tests passed**), i18n suite (**2 files / 9 tests passed**), backend/Web/Shared/i18n typechecks, Prettier for this report, and `git diff --check`; all passed. Backend functional tests and the PC-03 unit suite remain blocked as recorded above.

## Instance management and localization

Source inspection confirms stable category IDs, labels keyed by `SUPPORTED_LOCALES`, safe display fallback to the source locale/another available label/stable ID, manual label provenance, and persistence that does not overwrite manually edited labels. The admin editor lets an administrator maintain every supported locale. Manual category creation does not require a Provider; this remains consistent with the first-release manual workflow.

The backend exposes `translateMissingPublicCategoryLabels`, which requests only missing locales and protects manual labels. No production route or job currently invokes that callable automatically for AI-created categories. A newly AI-created category therefore keeps its source-locale label until an explicit caller or administrator fills the other locale. Fallback remains safe, but automatic translation completion is **PARTIAL** and should be resolved before treating all category labels as fully localized. No translation UI or new Provider flow was added in PC-07.

## AI contract review

Source review of the current prompt, schema, validator, and service found:

- The model can return `REUSE`, `CREATE`, `NO_MATCH`, or `NEEDS_REVIEW`; the prompt prioritizes existing category combinations, allows zero, and caps selection at three.
- Creation requires a reusable, distinct concept; server validation drops invalid IDs, over-limit results, wrong-script/unsafe labels, and same-locale collisions.
- Classification reads bounded record fields and category candidates. It does not write `sourceMeta` or access User Tags.
- Public classification resolves the instance Provider and does not pass a user ID or use personal BYOK.
- Manual assignment and exact-pair suppression are preserved by the assignment service.

Mock-provider tests cover cold start, reuse/combination, restrained creation, retry idempotency, zero-category outcomes, provider/budget deferral, manual precedence, suppression, and translation protection. They were not executable in the current backend test environment. **No real or paid AI call was made.**

## Discover, Save Intent, Library, and Reader

The Codex browser opened the existing `http://localhost:3000/discover` runtime without starting a service. The SourceRecord and legacy Catalog list requests returned HTTP 200, but both lists were empty. `GET /api/discover/categories` repeatedly returned HTTP 500 with a generic internal-server-error response. No category choices were rendered, so category filtering, pagination with data, missing-translation rendering, and the full Discover flow could not be accepted. The current response does not establish the 500 root cause; no development database migration or write was attempted.

At 390px, the empty Discover state had a 390px document width and no horizontal overflow. This checks only the anonymous empty state, not populated cards or dark mode. The Instance Administration route displayed “Sign in to access the admin console”; no authenticated admin session was available. Create/edit/assignment interactions, non-admin browser behavior, Light/Dark rendering, and desktop/mobile management layouts were **NOT TESTED** in the browser.

Save Intent → Library → Reader was **NOT TESTED** live: the browser was signed out and the available Discover lists were empty. Existing Web and backend tests cover the explicit Save Intent and membership paths, but backend functional execution requires the missing guarded test environment.

## PC-06 worker and scheduler

The implementation and test sources cover first sync, substantive evidence changes, unchanged sync, duplicate jobs, provider/budget deferral, UTC budget rollover, bounded attempts, manual assignment protection, and queue failure without blocking source sync. No real worker was started, no Redis queue was consumed or cleared, and no Redis isolation could be verified because `.env.test` was absent and the local Docker API was inaccessible. Real Worker restart/scheduler E2E is **BLOCKED**.

## Safety and Git

- No push, development/production migration, database write, Redis clear, real AI call, or User Tag P1/P2 change occurred.
- PC-07 admin candidate-search commit: `af2538835318709cdf82ed1e1e4bebcd5a80134d`; merged serially by Codex in `b6ed65cf228a2c29261af61c468c2f50e0709858`.
- The browser tool saved local snapshots/logs under `.playwright-mcp/`; they remain untracked and are not part of the merge.
- GitNexus was stale (64 commits behind in the initial query); its route impact lookup returned no route and the change scan found no mapped symbols. These were not treated as an all-clear. The new route, read model, DTO consumer, and authorization boundary were reviewed directly at source and call sites.

## Release readiness

Public Categories **did not pass overall PC-07 acceptance**. The implementation is integrated, but the current runtime cannot load category choices, the backend regression/integration checks need a verified `gloaming_test` environment, and authenticated Instance browser acceptance plus isolated Worker E2E remain outstanding. Discover is **not genuinely usable in the observed runtime** while its categories endpoint returns 500 and the current catalog is empty. Instance category management is **implemented but not browser-accepted**. The AI decision path appears aligned with the restrained-classification contract by source review and mocked test design, but runtime tests are blocked; automatic completion of missing labels for AI-created categories remains a localization follow-up.

The implementation phase should **remain open** until the runtime category 500 is diagnosed in an authorized environment, guarded backend tests pass against `gloaming_test`, an authenticated browser pass covers the management and Discover flows with safe fixtures, and the missing-label translation path is explicitly completed or accepted as a manual operation. PC-07 code baseline before this report commit: `b6ed65cf228a2c29261af61c468c2f50e0709858`.
