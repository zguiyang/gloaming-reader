# Personal AI Tagging P2 — Implementation Plan

> **Superseded (business quotas removed):** The per-user daily invocation quota described in this plan was removed in the MVP quota-removal change; see [mvp-quota-removal.md](mvp-quota-removal.md). The rest of this record is retained as historical evidence.

**Phase:** implementation and verification. This plan reflects the confirmed P2 scope and the implementation in the current working tree. Verification results and remaining acceptance are recorded in `personal-ai-tagging-p2-implementation.md`. It preserves the P1 User-first contract and does not restore global Taxonomy.

## 1. Current code integration points

- Personal EPUB upload remains in `apps/backend/src/domains/works/personal/personal-epub-upload.ts`; parsing reaches `ready` in `apps/backend/src/application/commands/run-content-parse-workflow.ts`.
- The ready transition now records an outbox row in the same database transaction. `apps/backend/src/application/jobs/content-parse.ts` dispatches it, and a small worker recovery pass re-dispatches queued rows.
- Settings uses `apps/web/features/settings/settings-page.tsx` and `settings-api.ts`, backed by the authenticated `/api/settings/personal-tagging` preference API.
- Tag selection and persistence live in `apps/backend/src/domains/library/tags/personal-ai-tagging.ts`; manual tag/association operations stay in `tags/service.ts`.
- The AI call reuses `invokeAi`, the existing `assist` and `translate` purposes, and the Provider Resolver. The P2 path is explicitly `user-only`, because the normal resolver falls back to an instance Provider.

## 2. Minimum business flow and control

1. Preference defaults off. Only a successful Personal EPUB ready transition can create a run row; there is no history scan or upload-time AI call.
2. The run captures the current preference generation. Turning the setting off or back on increments the generation; queued or in-flight older generations cannot persist labels, associations, or translations.
3. The separate `gloaming-personal-tags` queue runs at global concurrency two. A Redis lease permits one task per user. BullMQ uses two attempts with exponential backoff.
4. The worker reads only the Work owner’s tags and bounded EPUB metadata/context. It returns zero to three stable existing IDs and/or individually qualified new labels. Existing concepts are preferred; no tag is created to fill the cap.
5. A transaction rechecks owner, ready Personal Work, preference generation, and run state; it locks the Work and preference rows before applying changes.
6. Automatic tags use P1 localization and edit protection. The durable run is completed after optional translation attempts. A missing user-owned Provider, a quota limit, translation failure, or task failure never changes Work readiness.

Disabling does not cancel an in-flight Provider request. It invalidates that run’s write authorization; a call that already started may still consume the user’s Provider quota.

## 3. Schema and uniqueness

Migration `0046_personal_ai_tagging_p2.sql` adds:

| Schema                         | Purpose and constraint                                                                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_personal_tag_preference` | Per-user `enabled` default false, monotonic `generation`, UTC-day quota date, and used/reserved invocation counts. Checks keep generation/counts nonnegative and combined daily use at or below ten. |
| `user_tag.created_by`          | `manual` default or `ai`; the existing stable tag ID and `(user_id, normalized_name)` uniqueness stay intact.                                                                                        |
| `user_work_tag.source`         | `manual` default or `ai`; the existing `(user_id, work_id, tag_id)` uniqueness stays intact.                                                                                                         |
| `user_work_tag_suppression`    | Exact user/work/tag removal triple with a unique key and cascading user/work/tag foreign keys.                                                                                                       |
| `user_personal_tag_run`        | One application-created row per user/work, storing captured generation, state, attempts, stable error code, and timestamps. Unique `(user_id, work_id, generation)` is a final duplicate guard.      |

The P1 User Tag API remains compatible: omitted provenance defaults to `manual`; manual add upgrades an AI link and clears its exact suppression; manual removal stores suppression before deleting the link. No existing tag IDs or associations are rewritten.

## 4. Reused code and historical boundary

- Direct reuse: `invokeAi`, structured Zod output, `ai_invocation_log`, `SUPPORTED_LOCALES`, `normalizeTagName`, User Tag ownership checks, P1 translation completion, BullMQ infrastructure, and bounded reading context conventions.
- The current Resolver’s ordinary user-first behavior includes an instance fallback. P2 adds a strict user-owned resolver helper and uses it for classification and automatic translation; no instance-paid Provider can be selected by these jobs.
- Historical metadata code supplied bounded-context and structured-output patterns only. Its global `tag`, `category`, and `reading_work_tag` taxonomy writes and Admin-first flows remain excluded.

## 5. User control and manual precedence

- Manual association add/remove and AI persistence all lock the same Work row. The suppression triple is written/deleted in the same transaction as the association change, so order is deterministic under concurrent AI and user actions.
- AI uses `ON CONFLICT DO NOTHING` for associations and never downgrades a manual link. It checks suppression inside the write transaction and does not alter ReadingState.
- Existing user tags are never renamed or merged. Before applying an AI-selected existing ID, persistence verifies that its user-owned names did not change during the AI call.
- The Settings surface reports Provider availability, latest run state, and daily call use. Per-book manual reorganization is deferred as requested.

## 6. Idempotency, concurrency, and failure handling

- The outbox row is committed atomically with the Personal Work’s `ready` transition; queued-row recovery runs at Worker startup and once per minute.
- Job ID is derived from the durable run ID. Database uniqueness, the per-user Redis lease, and atomic association writes protect duplicate delivery and worker restart.
- A queued task checks generation before invoking AI and again under a locked preference row before writing. The translation helper repeats that generation check under the same row lock before each locale write.
- Only the tagging run state changes on failure. Parsing and reading readiness remain independent. Missing Provider is a non-retryable skipped state; transient invoke errors use the two BullMQ attempts.

## 7. Cost and Provider limits

- Per-user active tasks: one. Global active tagging tasks: two.
- Per book: one durable run; zero to three automatic associations.
- Retry: at most two queue attempts; Provider-internal retry is disabled for this path.
- Daily limit: ten combined classification and translation invocation reservations per user, reset by UTC date. Reaching the limit skips classification; if reached after classification, saved labels/links remain and missing translations stay missing.
- Input: title 240 chars, author 240, description 1,000, excerpt 1,600, at most 12 TOC titles of 90 chars, at most 100 existing tag candidates, conservative estimated input cap 3,500 tokens. Output: 1,200 tokens for classification and 800 for translation; each call times out after 25 seconds. The full EPUB is never sent.
- Only explicitly configured, usable, user-owned `assist`/`translate` models are eligible. A missing personal model skips/fails safely; no instance Provider fallback or real Provider call was used during verification.

## 8. Minimum automated tests

Coverage includes default-off and generation changes, same-work outbox idempotence, stale-generation skip after re-enable, missing personal Provider, zero tags, cross-language stable-ID reuse, invalid/duplicate candidate filtering, the three-association cap, AI association suppression during an in-flight user removal, manual re-add provenance, and translation failure/manual-edit preservation. The test suite also covers queue separation/concurrency and strict no-instance Provider resolution.

All database tests and the test migration are constrained to `gloaming_test`; live model calls are not part of automated tests.

## 9. Implementation files

- DB: `packages/db/src/schema.ts`, `packages/db/src/index.ts`, migration `0046_personal_ai_tagging_p2.sql`, snapshot and migration journal.
- Backend: tag automation and manual service/routes, Personal parse finalization, worker, queue wrapper, Provider Resolver, invoke options/client limits, and focused tests.
- Web/i18n: existing Settings page/API and English/Chinese strings. No second tag-management page and no book reorganization action.
- Delivery evidence: `docs/reviews/user-first/personal-ai-tagging-p2-implementation.md`.

## 10. Product decisions

The user has confirmed the default-off Settings toggle, future successful parses only, generation invalidation on off/on, three-link automatic cap with zero allowed, BYOK-only Provider use, two attempts, one per-user/two global concurrency, daily budget, and deferral of single-book reorganization. No additional product decision is required for this P2 slice.
