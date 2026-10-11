# Personal AI Tagging P2 — Implementation Report

**Status:** implemented; automated verification is partial as listed below. Commits `f95775ec` and `3ea34ec4` are on `dev-02`; neither was pushed.

## 1. Scope changed

- Added an opt-in personal EPUB auto-tag preference, a durable parse-ready outbox/run record, a dedicated BullMQ queue, and a worker with per-user locking and global concurrency two.
- Added server-side structured tag selection, existing-tag reuse, conditional durable tag creation, association provenance and removal suppression.
- Reused the existing Provider Resolver, `invokeAi`, and P1 user-tag translation completion. The P2 path rejects instance Provider fallback and uses only a configured, usable Provider owned by the current user.
- Added a simple toggle and run/provider/quota feedback to the existing Settings surface. Library and Book Manage Tags remain the existing manual management surfaces; no per-book reorganization action was added.
- Updated the P2 plan. No public taxonomy, catalog tagging, upload-time AI, batch history processing, or new AI framework was introduced.

## 2. Schema and migration

Migration `0046_personal_ai_tagging_p2.sql` adds:

| Field or table                 | Purpose and constraint                                                                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_personal_tag_preference` | One row per user; `enabled` defaults false; monotonic `generation` invalidates old authorization after each on/off transition; UTC daily used/reserved invocation counts are capped at ten combined. |
| `user_tag.created_by`          | `manual` by default or `ai`; existing stable tag IDs and per-user normalized-name uniqueness remain unchanged.                                                                                       |
| `user_work_tag.source`         | `manual` by default or `ai`; existing association unique key remains unchanged. A manual add upgrades an existing AI association to manual.                                                          |
| `user_work_tag_suppression`    | Unique `(user_id, work_id, tag_id)` suppression for a user’s explicit AI-link removal; foreign keys cascade with the corresponding entities.                                                         |
| `user_personal_tag_run`        | Durable state and attempt count, keyed uniquely by `(user_id, work_id, generation)` to guard duplicate run creation.                                                                                 |

The existing User Tag APIs remain compatible: omitted provenance is manual, existing IDs are preserved, and manual add/remove update provenance/suppression atomically. The migration was applied only to the confirmed isolated `gloaming_test` database for automated tests. It was not run on the development or production database. A development migration is still required before using this feature against a development database.

## 3. Authorization and parse trigger

- Preference defaults off. Only the successful Personal EPUB transition to `ready` inserts a run, in the same transaction as readiness. The run captures the current generation; there is no history scan.
- Turning the setting off or on increments the generation. A queued or in-flight run from an earlier generation cannot gain write authority after re-enable.
- The outbox dispatcher recovers queued rows at worker startup and every 60 seconds. BullMQ job IDs derive from durable run IDs; attempts are capped at two.
- The worker checks user, Work ownership, Personal EPUB origin, ready state, and generation before calling AI. The final write transaction rechecks authorization under locked Work, preference, and run rows.
- Parse failure does not enter the successful ready-transition path. AI work is isolated from parsing and reading readiness.

## 4. AI reuse and creation

- The prompt receives only the owner’s tags and bounded book evidence: title, author, language, description, one excerpt, and up to twelve section titles. The full EPUB is never sent.
- Context is limited to an estimated 3,500 input tokens, with field-level character limits and a maximum of 100 existing tag candidates. Classification output is limited to 1,200 tokens; translation output to 800; each call times out after 25 seconds.
- The model returns a structured result with stable IDs for existing tags or new candidates. Server validation filters foreign IDs, duplicates, excessive selections, exact normalized localized-name duplicates, invalid names, and names that do not match the source language’s script. No model output directly chooses a database operation.
- Existing user tags are listed only for the owner and offered with their localized names. Cross-language reuse is represented by reusing the same tag ID. A new tag must independently assert durable reuse value and distinction from existing concepts; the server still validates the output and caps total automatic associations at three. Zero is valid.
- AI-created tags start with the source-locale name and then call the P1 translation helper for other supported locales. Translation failure leaves the source name and association intact. P1’s user-edited locale guard and generation check protect manual edits and revoked authorization.

## 5. Concurrency and manual control

- AI writes and manual association add/remove lock the same Work row. A removal writes its suppression and deletes the association in one transaction; AI checks suppression in its association transaction. This gives the two operations a serial order. Manual re-add clears suppression and sets provenance to manual.
- AI never downgrades an existing manual association. Tag creation uses the existing per-user normalized-name uniqueness constraint and conflict handling; association creation uses the existing composite unique key.
- Off/on generation changes are serialized through the preference row. Translation updates check generation and missing/editable locale conditions inside their write transaction.
- A successful association transaction is durable before optional translation. The run is marked complete after translation attempts, so a worker failure during optional translation remains eligible for bounded retry. A translation error itself is treated as optional enrichment failure and does not undo tags or links.
- ReadingState is not modified by the tag workflow. Personal Work is not deleted or rewritten by tag assignment.

## 6. Provider and cost controls

- This workflow uses a strict user-owned Provider Resolver path for both `assist` classification and `translate` completion. It does not use the normal instance fallback. Provider absence skips the run before classification.
- Per-user active tagging work is limited to one Redis lease; the dedicated worker has global concurrency two. The task uses a 90-second renewable lease with a two-minute maximum renewal window.
- Each user has a daily budget of ten combined classification and translation invocations, counted/reserved in the preference row by UTC date. At the limit, classification is skipped; if the limit is reached after classification, saved names/associations remain and remaining translations stay missing.
- Queue attempts are limited to two and Provider-internal retries are disabled. Mock AI was used in tests; no live or paid model was called.

## 7. Automated verification

Successfully executed:

- Backend targeted tests, using `gloaming_test` and test Redis: 5 files, 30 tests passed. Covered P2 decision validation, default off, no retroactive run, generation invalidation after off/on, duplicate run prevention, missing user Provider, zero-tag output, explicit removal racing an AI response, manual re-add, unchanged ReadingState, translation failure preservation, in-flight manual translation edit protection, strict user-only Provider resolution, P1 user-tag routes, and queue cleanup.
- Full backend suite, using the isolated test database and test Redis: 103 files passed, 1 skipped; 641 tests passed, 2 skipped.
- Web tests: 43 files, 248 tests passed.
- i18n tests: 2 files, 9 tests passed.
- Workspace typecheck: shared, i18n, db, backend, and web passed.
- `pnpm lint`, targeted Prettier check, and `git diff --check` passed.

The initial sandbox attempts could not connect to local PostgreSQL/Redis; they were stopped. The full backend suite and migration were then run with access to the confirmed `gloaming_test` database and test Redis. No development or production database was used.

## 8. Remaining acceptance and limits

- No real Provider or live paid AI verification was performed. Classification and translation behavior were tested with mocks only.
- Internal-browser navigation to `http://localhost:3000/settings` returned connection refused because no web server was running. Starting the dev server is prohibited by the repository instructions, so the Settings toggle, localized strings, responsive layout, and light/dark theme still need internal-browser acceptance. No local browser was used.
- The automated suite does not yet independently exercise every requested end-to-end path (notably real parse failure/ready enqueue integration, worker crash/stalled-job recovery, quota boundary under concurrent reservations, all three persisted associations, and cross-user tag read/edit attempts through every route). The implementation includes corresponding guards and existing route ownership checks, but these scenarios should be added to automated coverage or explicitly verified before broad release.
- The database migration is required before deploying/running this schema in development. It has not been run there.
- Exact quota use is a simple per-user daily invocation budget, not billing or a cost accounting system.

## 9. Git state

- Branch remains `dev-02`; the settings and core implementation commits are `f95775ec` and `3ea34ec4`.
- The project-local Pi Skill deletions, `skills-lock.json` edit, and other uncommitted review documents remain in the working tree. They were not reset, stashed, or cleaned.
- No push, development database migration, production database operation, or real AI call occurred.

## 10. P2 completion statement

The P2 implementation is present, but final acceptance is not complete until the pending lint/format checks and internal-browser review are completed. There is no known architectural blocker. Automated tests provide focused evidence for the primary authorization, reuse, manual protection, and failure paths; the listed coverage gaps remain. P2 does not restore the deferred automatic tagging behavior for any non-Personal work. Restoring auto-tagging for EPUBs beyond this scope would require a separate approved phase and is not started here.

## Final Acceptance Review

This section supersedes the earlier pending-check summary above and records the final review for this task. Status labels describe the evidence collected here, not an assertion that every production runtime condition was exercised.

| Area                                 | Status                                                             | Evidence and limits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parse-ready eligibility and opt-in   | PASS                                                               | Source review confirms run creation is in the successful Personal EPUB `ready` transaction; helper-level tests cover non-ready/failed, non-Personal, disabled, and duplicate ready events. Full EPUB parse success/failure integration was not run.                                                                                                                                                                                                                                                                                                             |
| Reading safety                       | PASS                                                               | AI failure only changes the tagging run. The removal/re-add functional test confirms ReadingState remains unchanged and source review confirms the workflow does not update Work readiness.                                                                                                                                                                                                                                                                                                                                                                     |
| Authorization generation             | PASS                                                               | Tests cover off/on invalidating a captured generation; the final transaction rechecks enabled state, generation, owner, origin, and ready status.                                                                                                                                                                                                                                                                                                                                                                                                               |
| Manual link protection               | PASS                                                               | A database-backed race test removes an association while AI is in flight and confirms suppression wins; manual re-add clears suppression and stores `manual`. Existing User Tag API tests pass.                                                                                                                                                                                                                                                                                                                                                                 |
| Translation edit protection          | PASS                                                               | A delayed translation response cannot replace a locale edited while the response was in flight. Translation failure leaves the source-language tag and association intact.                                                                                                                                                                                                                                                                                                                                                                                      |
| Daily reservation and UTC settlement | PASS                                                               | Concurrent reservations at the cap do not exceed ten. Classification and translation both reserve calls. A regression test covers overlapping work across UTC midnight. This review fixed settlement to use the date captured by each reservation; a missing-preference path now returns `null` as required by its type. Failed/timed-out invocations settle as used; a hard process death before settlement may leave a reservation until the next day reset.                                                                                                  |
| Quota exhaustion outcome             | PARTIAL                                                            | At ten reservations, the run becomes terminal `skipped/daily_limit_reached`. It stays skipped after the UTC date changes, so the book is permanently skipped unless a separate future user action is added. No such action exists in this P2 scope. Recommended minimal fix: a deferred state with `eligible_at` set to next UTC midnight and have the existing dispatcher revisit due rows only when the current preference generation still authorizes them. Product decision required on whether to retry automatically; no scheduling change was made here. |
| Per-user and global concurrency      | PARTIAL                                                            | The Redis user lease and two-attempt BullMQ job limit are present. Worker concurrency is set to two per Worker process; this is not a cluster-wide cap if multiple replicas run. Lease-loss behavior is tested through a callback simulation and fences persistence, but an outstanding Provider request cannot be canceled and may overlap a retry after lease expiry.                                                                                                                                                                                         |
| Worker crash recovery                | PARTIAL                                                            | Duplicate completed delivery is tested, as is a simulated lease loss followed by a bounded retry. Queue startup/periodic dispatch recovers `queued` rows and BullMQ retries stalled jobs. Actual process termination, Redis lease expiry, hard failure between AI completion and commit, post-commit redelivery, and restart recovery were not simulated. There is no independent stale-`processing` database recovery scan; recovery depends on BullMQ redelivery. A lost/terminal queue event could therefore leave a run in `processing`.                    |
| AI output and reuse rules            | PASS for server-enforced constraints; PARTIAL for semantic quality | Prompt, structured schema, and server checks enforce owned candidate IDs, zero to three selections, source-locale names, duplicate filtering, and durable/reusable assertions for new labels. Candidate listing is user-scoped and includes localized names. Cross-language concept reuse is guided by the model using those names, but semantic equivalence remains model judgment. Mock tests verify plumbing and validation only; no live semantic quality claim is made.                                                                                    |
| Other-user isolation                 | PASS by source and existing API tests                              | AI candidate queries filter by owner; persistence rechecks owner and tag ownership. Existing user-tag API ownership tests passed. A dedicated cross-user P2 worker mutation race was not run.                                                                                                                                                                                                                                                                                                                                                                   |
| Browser acceptance                   | BLOCKED                                                            | Codex internal browser navigation to `http://localhost:3000/settings` returned connection refused. No approved Web service was running. Repository rules prohibit starting `dev:*`, `start`, or `preview`, so Settings visuals, locale/theme variants, narrow viewport, and runtime status/quota feedback were not browser-verified. No local browser or real user data was used.                                                                                                                                                                               |
| Real Provider                        | NOT TESTED                                                         | All AI calls in automation used mocks. No real or paid Provider was called.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Added checks and actual fixes

- Added eight database-backed functional cases for parse-ready eligibility, disabled preferences, duplicate ready events, concurrent quota reservations, simulated lease loss/retry, duplicate delivery, terminal cap behavior after a day change, and cross-midnight settlement.
- Focused backend run against the confirmed isolated `gloaming_test` database: 4 files, 33 tests passed (`personal-ai-tagging`, `user-tags`, `user-first-provider-resolver`, and the P2 unit spec). Test Redis was isolated on DB 1. No migration was run in this review.
- Web Settings API test: 1 file, 4 tests passed.
- Workspace typecheck passed after fixing the return type identified during the first run. `pnpm lint` passed. Targeted Prettier check and `git diff --check` passed after formatting the added functional test.
- A first attempted backend test command used a broad filter and hit the sandbox's local database connection restriction; it was stopped. The exact test-file run then passed with access to the confirmed test database. No development database was used.

### Remaining decision and closure

- Quota exhaustion currently permanently skips a book. Decide whether P2 should automatically retry at the next UTC reset; if yes, implement the small deferred-run change before closing P2.
- To complete browser acceptance, start an approved isolated test environment with the backend pointed only at `gloaming_test`, Redis DB 1, the Worker for queue feedback, and a disposable account. Then review Settings in Codex internal browser for default/off/on, missing Provider, run/quota feedback, English/Chinese, light/dark, desktop, and a narrow viewport. The dev server was not started by this review.
- Process-level BullMQ crash/stalled recovery remains unproven. Run a controlled test-worker crash/restart exercise in an isolated environment before claiming crash recovery complete.
- No schema change was made during final acceptance and no migration was executed. Migration `0046_personal_ai_tagging_p2.sql` remains required before using the feature on a development database.
- P2 is **not ready for formal closure**: browser acceptance is blocked, process-level recovery is only partially evidenced, and quota-exhaustion retry behavior needs a product decision. The implementation remains within P2; no P3 feature was started.
- Git remains on `dev-02` with all pre-existing uncommitted changes preserved plus the reviewed P2 edits. No commit, push, development/production migration, database clearing, or real AI call occurred.

## Core Business Acceptance — 2026-10-11

This acceptance reviews the current P2 classification path and its Mock-backed behavior only. A `PASS` on a Mock case means the request, validation, and persistence path behaved as expected for the supplied deterministic result; it does **not** mean a real model will choose that result.

**Current flow:** after an opted-in Personal EPUB reaches `ready`, the dedicated run loads bounded book evidence and only the owner's tags (up to 100). It sends primary/localized tag names and the evidence to user-only `assist` with a structured decision schema. The server filters candidate IDs/names, then a transaction rechecks owner, ready state, authorization generation, run/lease state, current tag ownership, and removal suppression before creating any qualified new tags and associating no more than three. Optional translation of AI-created tags follows through the existing user-only `translate` path; classification/translation failure does not block Work readiness.

### Core findings

| Acceptance item                                    | Status  | Evidence and limit                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Book evidence sent to AI                           | PASS    | The worker sends bounded title, author, language, description, one excerpt, and up to twelve section titles. It does not classify from title alone and does not send the full EPUB. If evidence is insufficient, the valid zero-tag result is available.                                                                                                                                                |
| Candidate ownership and localized names            | PARTIAL | Candidate query is scoped to the current user and includes localized names plus the primary name. A null legacy `sourceLocale` is now represented as an unlocalized primary name instead of being mislabeled with the book locale. Candidates still have no separate semantic definition/alias fields. More than 100 owned tags currently skips the run instead of selecting a bounded relevant subset. |
| Reuse-first and cross-language Prompt              | PARTIAL | The Prompt now explicitly directs the model to compare concept meaning rather than wording, reuse stable IDs for aliases/translations, evaluate applicable existing tags and combinations first, abstain when none fit, and create only durable cross-work concepts. Static Prompt wording is tested; actual model compliance is not.                                                                   |
| Existing-tag combination behavior                  | PARTIAL | Prompt rules cover an adequate existing combination and prohibit narrower/book-specific composite labels. Three deterministic Mock scenarios exercise reuse for science-fiction/adventure/suspense, React/software engineering, and AI-development-history examples. Those examples verify execution of returned IDs only.                                                                              |
| New-tag restraint and duplicate concepts           | PARTIAL | New candidates require source-locale names, a durable-use rationale, and `reusable`/`distinctFromExisting` assertions. Server checks normalized exact duplicates and same-response exact duplicate names. It cannot reliably identify differently worded semantic duplicates; the Prompt now asks for new candidates to be distinct from one another, but that remains model-dependent.                 |
| Structured output and three-tag limit              | PASS    | Zod constrains the fields and rejects a combined existing-plus-new selection above three. The server also filters foreign IDs, duplicate IDs, normalized name collisions, and wrong-script/source-locale names; persistence rechecks owner and work eligibility. Tests cover combined overflow and remaining-capacity behavior.                                                                         |
| User ownership, idempotency, and manual control    | PASS    | Owner-only candidate context is tested with two users. Existing source review and functional tests cover final owner checks, duplicate run prevention, suppression during a concurrent manual removal, manual re-add precedence, and generation invalidation.                                                                                                                                           |
| Translation persistence and manual edit protection | PARTIAL | Mock tests confirm translation failure preserves the AI-created source name and association, and an in-flight response cannot replace a manual translation. Translation quality and cross-language terminology were not checked with a live model.                                                                                                                                                      |
| Reading safety                                     | PASS    | Tagging failure does not change Work readiness or ReadingState. Mock and database-backed tests confirm these boundaries.                                                                                                                                                                                                                                                                                |
| Public classification dependency                   | PASS    | No shared taxonomy or public classification code is required by this P2 change. The remaining live semantic-quality gap means P2 must not be cited as proof of public-category model quality; public classification still needs its own acceptance.                                                                                                                                                     |

### Fixes in this acceptance

- The previous Prompt did not explicitly require semantic cross-language/alias reuse or prohibit new composite labels when existing combinations were sufficient. It now states both and asks that new candidates be distinct from each other.
- The structured schema limited each result array to three independently, so a combined response could have four selections before server cleanup. It now rejects combined selections above three; server cleanup retains its defensive cap.
- A legacy tag with no `sourceLocale` was previously sent with the book locale attached to its primary name. The context now carries the primary name and null locale separately, and the Prompt tells the model to treat that label as unlocalized.

### Scenario coverage

| Suggested case                                                                  | Status                | Result                                                                                                                                                                              |
| ------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01. Reuse science fiction + adventure + suspense instead of a composite tag     | PASS (Mock execution) | Functional Mock returns the three owned IDs; all three links persist and no composite tag is created. Real model selection is not tested.                                           |
| 02. React technical book reuses applicable frontend/software-engineering labels | PASS (Mock execution) | Functional Mock returns existing IDs; no React-specific tag is created. Real model selection is not tested.                                                                         |
| 03. AI development history uses an adequate existing combination                | PASS (Mock execution) | Functional Mock returns existing history/technology/science IDs; no book-title tag is created. Real model selection is not tested.                                                  |
| 04. “科幻小说” versus existing “科幻”                                           | PARTIAL               | Prompt instructs semantic comparison and exact localized-name checks exist, but no deterministic server rule can establish this semantic relation and no live model call was made.  |
| 05. “Science Fiction” versus existing “科幻”                                    | PASS (Mock execution) | Functional test confirms both localized names reach the model context and the returned stable ID is persisted without creating another tag. Model inference is not tested.          |
| 06. No existing tags and one clear book topic                                   | PASS (Mock execution) | Existing new-tag creation and translation-failure tests confirm a qualified new tag can persist. They do not measure whether a model creates only when needed.                      |
| 07. Existing tags do not apply                                                  | PARTIAL               | Qualified new-tag persistence is tested; the “no existing tag fits” judgment is supplied by the Mock.                                                                               |
| 08. Insufficient evidence                                                       | PASS (Mock execution) | Zero selected tags are accepted and create no association; whether a live model abstains on sparse metadata is untested.                                                            |
| 09. Many existing tags                                                          | PARTIAL               | Output is capped at three. The worker supports at most 100 candidates and skips the entire run above that limit; relevant-subset retrieval beyond 100 is not implemented or tested. |
| 10. Repeat processing                                                           | PASS                  | Duplicate ready events are idempotent; completed runs are fenced and normalized-name/association uniqueness prevents duplicate persisted records.                                   |
| 11. User removes an AI link                                                     | PASS                  | In-flight response/removal race test confirms the exact association remains suppressed.                                                                                             |
| 12. User manually re-adds the removed link                                      | PASS                  | Functional test confirms re-add clears suppression and records manual provenance.                                                                                                   |
| 13. Same-named tags owned by two users                                          | PASS                  | Functional test creates same-named tags for separate users and confirms only the current owner's candidate reaches AI and is associated.                                            |
| 14. Translation fails for an AI-created tag                                     | PASS (Mock execution) | Source name and association remain durable when translation invocation fails.                                                                                                       |
| 15. User edits a translation while AI is in flight                              | PASS (Mock execution) | Delayed translation response does not replace the manual value.                                                                                                                     |
| 16. Over-limit/invalid model output                                             | PASS                  | Schema rejects more than three combined selections; server filtering and source-locale checks are covered by unit tests.                                                            |

### Verification performed

- P2, User Tag, and user-only Provider tests: 4 files, 37 tests passed against the configured `gloaming_test` database. Vitest forces Redis DB 1. The default sandbox first blocked the local test connection; the same command then passed with access to the verified test services. Test-created records are cleaned by the test fixtures.
- Backend typecheck: passed.
- ESLint on the changed backend source and test files: passed.
- Targeted Prettier check: passed.
- `git diff --check`: passed.
- GitNexus reported its index 34 commits behind HEAD, so it was not used as an impact all-clear. Manual search and source review confirmed the schema's production use is the P2 `invokeAi` call and the new focused tests.
- No migration, development/production database operation, queue cleanup, Worker startup, or real Provider call was performed.
- After the implementation commit, the focused pure unit suite `tests/unit/domains/library/personal-ai-tagging.spec.ts` passed (7 tests). Vitest enforced `TEST_DATABASE_URL=gloaming_test`; the unit cases made no database writes.

### Real AI Semantic Acceptance — cases prepared, execution pending

The following eight synthetic inputs use the same fields assembled by P2 (`title`, `author`, `language`, `description`, `excerpt`, `tocTitles`, and owned `existingTags`). They are test fixtures, not expected literal model outputs. At execution, use the current P2 system prompt, `personalTagDecisionSchema`, `validatePersonalTagDecision`, the current user's `user-only` `assist` resolver, and `invokeAi`; do not substitute a shorter prompt. Judge concept selection and rationale, not exact names or ordering. Record the raw structured output, accepted IDs/new concepts, validation changes, and PASS/PARTIAL/FAIL per case.

All `tag-*` identifiers below are synthetic candidate IDs. They must be supplied as the candidate list for the corresponding sample; no actual user tags or associations are used.

#### Case 1 — Same-language reuse

- **Book:** _The River Remembers_; author: Lena Park; language: `en-US`.
- **Description:** A field biologist follows a temperate river through seasonal floods, fish migration, wetland recovery, and the effects of nearby farming.
- **Excerpt:** “At the first winter thaw, the river carried more than water downstream. Flooded banks left silt among the willow roots, and shallow pools warmed before the main channel. Young fish gathered there until the current weakened. By late spring, reeds had returned to the abandoned bend, drawing insects and wading birds. We measured oxygen, sediment, and species counts at each site, then compared restored banks with those still constrained by concrete walls.”
- **TOC:** “A Living Channel”; “Floodplains and Fish”; “Restoring the Banks”.
- **Existing tags:** `tag-ecology` — `Ecology` (`en-US`); `tag-freshwater` — `Freshwater Biology` (`en-US`); `tag-conservation` — `Conservation` (`en-US`); `tag-field-biology` — `Field Biology` (`en-US`).
- **Reasonable behavior:** Reuse the applicable established tag or combination; create nothing if those tags adequately describe the book.
- **Do not:** Create a title-specific or narrower duplicate such as a one-book label about river restoration.

#### Case 2 — Chinese book reuses an English concept

- **Book:** 《潮汐之间》; author: 林澄; language: `zh-CN`.
- **Description:** 一部虚构小说，讲述海平面上升后沿海社区迁居、重建生活并保存地方记忆的过程。
- **Excerpt:** “海水越过旧防波堤的那一年，镇上的人开始把门牌写在木箱上。有人去了山城，有人留在临时搭起的学校里。阿禾每周回到海边，记录潮线移动到哪一棵树下，也记录谁还没有决定离开。多年以后，新的堤岸保护了港口，却没有让所有人回到原来的家。她把这些口述故事整理成一册，留给后来出生的孩子。”
- **TOC:** “最后一次涨潮”; “临时的家”; “新的海岸线”.
- **Existing tags:** `tag-climate-fiction`, primary name `Climate Fiction` (`en-US`), localized name `气候小说` (`zh-CN`); `tag-migration`, primary name `Migration` (`en-US`), localized name `迁徙` (`zh-CN`).
- **Reasonable behavior:** Reuse the stable climate-fiction concept ID, optionally with another applicable existing tag; language difference alone is not a reason to create a new tag.
- **Do not:** Create a Chinese duplicate of the same concept or a book-title tag.

#### Case 3 — Multiple existing tags are sufficient

- **Book:** _Below the Blue Shelf_; author: Omar Bell; language: `en-US`.
- **Description:** A nonfiction account of cold-water coral communities, ocean warming, deep-sea surveys, and marine habitat protection.
- **Excerpt:** “The cameras crossed a ridge where sunlight never reaches. Pale coral branches held small crabs and juvenile fish, while the temperature loggers showed a gradual rise over the past decade. Our team mapped the habitat, compared the images with older surveys, and shared the results with the regional conservation group. The evidence cannot tell us how every colony will respond, but it shows why deep-sea ecosystems belong in climate and marine protection plans.”
- **TOC:** “A World Without Sunlight”; “Surveying the Ridge”; “Protection at Depth”.
- **Existing tags:** `tag-marine-biology` — `Marine Biology` (`en-US`); `tag-climate-change` — `Climate Change` (`en-US`); `tag-conservation` — `Conservation` (`en-US`); `tag-oceanography` — `Oceanography` (`en-US`).
- **Reasonable behavior:** Reuse a sufficient subset or combination of these stable topics.
- **Do not:** Add a composite label that merely combines existing concepts, or a narrow species/site label unsupported as a reusable concept.

#### Case 4 — Broad existing tags do not cover a durable topic

- **Book:** _A Shape That Cannot Untie_; author: Nia Foster; language: `en-US`.
- **Description:** An accessible introduction to mathematical knot theory, covering equivalence, invariants, diagrams, and applications in topology.
- **Excerpt:** “Two loops may look different on paper while describing the same knot. The central question is which transformations preserve that identity. We begin with diagrams and crossings, then use simple invariants to show why some knots cannot be changed into the unknot. Later chapters connect these ideas to three-dimensional spaces and explain how mathematicians use knot theory as a precise language for problems that ordinary geometry does not settle.”
- **TOC:** “Knots and Equivalence”; “Crossings and Invariants”; “A Topological View”.
- **Existing tags:** `tag-mathematics` — `Mathematics` (`en-US`); `tag-geometry` — `Geometry` (`en-US`); `tag-puzzles` — `Puzzles` (`en-US`).
- **Reasonable behavior:** Reuse broad tags where they apply and consider one stable, widely reusable concept for the book's central subject if the combination remains too broad.
- **Do not:** Treat a broad parent tag as automatically sufficient, or create chapter-level terms, theorem names, or a title-specific tag.

#### Case 5 — User has no tags

- **Book:** _How We Find Out_; author: Mateo Ruiz; language: `en-US`.
- **Description:** A clear introduction to scientific reasoning, observation, hypothesis testing, measurement, and revision of explanations.
- **Excerpt:** “A useful explanation must risk being wrong. We observe a pattern, state what we expect to happen, and choose a measurement that could contradict our idea. Repeating the observation helps separate a real effect from chance or faulty equipment. When results disagree with our prediction, we revise the explanation and describe what changed. This cycle does not guarantee certainty, but it gives other people enough detail to check and build on the work.”
- **TOC:** “Questions and Observations”; “Testing an Explanation”; “Changing Our Minds”.
- **Existing tags:** none.
- **Reasonable behavior:** One broad, durable topic may be created because the evidence is strong; zero is also acceptable if the model cannot justify a stable reusable concept.
- **Do not:** Fill the three-tag limit, create multiple overlapping labels, or use the book title as a tag.

#### Case 6 — Near-synonym should reuse, not duplicate

- **Book:** _Power After Coal_; author: Ada Mensah; language: `en-US`.
- **Description:** A practical overview of replacing fossil-fuel electricity with renewable sources, grid storage, and community-scale clean power.
- **Excerpt:** “The transition is not a single machine replacing another. Wind and solar production vary by hour, so storage, transmission, demand planning, and local policy all matter. The examples compare several communities that retired coal plants and built cleaner electricity systems. Their choices differ, but each case asks the same question: how can reliable power be supplied while reducing pollution and sharing the cost of change?”
- **TOC:** “Leaving Coal”; “Storage and the Grid”; “A Fair Transition”.
- **Existing tags:** `tag-renewables`, primary name `可再生能源` (`zh-CN`), localized name `Renewable Energy` (`en-US`); `tag-clean-power`, primary name `清洁能源` (`zh-CN`), localized name `Clean Power` (`en-US`); `tag-energy-policy`, primary name `能源政策` (`zh-CN`), localized name `Energy Policy` (`en-US`).
- **Reasonable behavior:** Reuse the applicable existing concept IDs and avoid adding another label that means substantially the same thing; distinguish energy sources from policy if both are useful.
- **Do not:** Create a near-synonym solely because the title uses different wording, or merge genuinely distinct existing concepts.

#### Case 7 — Evidence is too weak; abstention is valid

- **Book:** _Field Notes_; author: Unknown; language: `en-US`.
- **Description:** “A collection of notes.”
- **Excerpt:** “The page is dated Tuesday. A blue cup was left near the window. The writer copied a phone number, crossed it out, and made a list of errands. The next page contains three weather observations and an unfinished sentence. There are no chapter headings, subject terms, or further context to explain who wrote the notes or why they were collected.”
- **TOC:** none.
- **Existing tags:** `tag-biology` — `Biology` (`en-US`); `tag-travel` — `Travel` (`en-US`); `tag-memoir` — `Memoir` (`en-US`).
- **Reasonable behavior:** Return zero tags because the evidence does not establish a reliable subject or genre.
- **Do not:** Infer a topic from the generic title, force the closest available tag, or invent a tag to avoid an empty result.

#### Case 8 — Technical book should avoid over-fine labels

- **Book:** _Reliable Services in Practice_; author: Priya Nair; language: `en-US`.
- **Description:** A broad engineering guide to designing, operating, and improving distributed services, including architecture, failure handling, observability, and team practices.
- **Excerpt:** “A service is reliable when its users can depend on the behavior that matters to them. This book starts with system boundaries and failure assumptions, then follows requests through storage, networks, deployment, and monitoring. Short case studies show how teams use timeouts, redundancy, clear ownership, and measured service objectives. Individual algorithms appear as examples, but the recurring subject is how to design and operate dependable software systems as a whole.”
- **TOC:** “Service Boundaries”; “Failures and Recovery”; “Observability”; “Operating in Teams”.
- **Existing tags:** `tag-computer-science` — `Computer Science` (`en-US`); `tag-software-engineering` — `Software Engineering` (`en-US`); `tag-distributed-systems` — `Distributed Systems` (`en-US`); `tag-cloud-computing` — `Cloud Computing` (`en-US`).
- **Reasonable behavior:** Reuse the relevant broad and established tag combination.
- **Do not:** Create tags for an individual algorithm, protocol, metric, or implementation detail when the existing combination covers the book.

#### Execution gate and side effects

No model was configured or called while preparing these cases. The production P2 call is embedded in `processPersonalTaggingJob`, which also reads a run/work/tags, reserves quota, and may persist associations. A safe acceptance harness must reuse the exact prompt construction, schema, server validator, and `invokeAi` path while bypassing the queue and all tag/run/quota writes. `invokeAi` itself writes the normal AI invocation audit record, so that audit row is an expected and separately disclosed database side effect unless the user approves a minimal isolated dry-run hook that suppresses only that audit write. Do not start a Worker or call the model until the selected user-owned Provider/model, current price, call cap, cost cap, and explicit approval are recorded.

At the current implementation limits, the original planning estimate remains a ceiling of about 28,000 input tokens and 9,600 output tokens (8 × 3,500 input and 1,200 output), not a usage guarantee. Actual price and expected cost cannot be stated until the user's Provider and model are known. No calls were made.

### Watchlist and closure

- **BLOCKED — Worker end-to-end:** not run because the Worker environment has unrelated business-queue backlog and the request forbids starting a Worker that could consume it.
- **NOT TESTED this turn — Browser:** not repeated per this request. It records prior browser acceptance for Settings, English/Chinese, Light/Dark, 390px layout, the auto-organization switch, and quota display; this supersedes the older blocked-browser note above.
- **PARTIAL — Large candidate sets:** over 100 tags skip classification rather than retrieve a relevant subset. This is a bounded-candidate limitation, not addressed in this acceptance.
- **PARTIAL — Real semantic quality:** cross-language equivalence, topic applicability, abstention, and duplicate-concept restraint remain unproven until the authorized sample run.
- **PARTIAL — Non-core runtime watchlist:** process-level BullMQ crash/stalled recovery, cluster-wide concurrency, and retry after daily quota exhaustion remain as recorded above. These are not evidence of semantic quality and were not re-tested here.
- **Git:** branch remains `dev-02`; code, cleanup, and review-document changes were committed in separate batches. This preparation update is a separate documentation batch. Nothing was pushed.

Core business acceptance is **PARTIAL** until real-model semantics and the blocked Worker end-to-end path are separately authorized and verified. No known architectural blocker to later public-classification work was found; the remaining gap is evidence of model behavior, not a dependency on a shared taxonomy implementation.
