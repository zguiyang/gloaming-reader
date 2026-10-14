# MVP Business Quota Removal

**Status:** implementation, schema change, and the forward-only migration SQL are
complete in the working tree. The migration data repair passed a TEMP-table
regression in a verified local `gloaming_test`; migration `0051` itself is not
applied and its post-migration persistent runtime is unverified. This record
describes the forward-only quota removal only.

## 1. What was removed

Two product business quotas were deleted. They were administrative spend guards,
not user plan limits or billing.

- **Public classification daily reservation** (instance-wide `50` calls/UTC day).
  Removed the `PUBLIC_CLASSIFICATION_DAILY_RESERVATION_LIMIT` constant, the
  `budget_unavailable` deferral reason, the `public_classification_budget`
  singleton reserve/settle repository code, and the next-UTC-midnight retry helper.
- **Personal tagging daily invocation quota** (per-user `10` calls/UTC day).
  Removed `PERSONAL_TAG_DAILY_INVOCATION_LIMIT`, the preference reserve/settle
  helpers, the `daily_limit_reached` terminal skip, and the quota DTO fields.

What is intentionally retained:

- Public classification: the bounded two-attempt retry, provider-unavailable
  handling, generic busy/provider/transient retry scheduling, evidence
  fingerprint, outbox dispatch, instance lock, and manual-assignment/suppression
  protection.
- Personal tagging: the user-only provider resolver, bounded run attempts
  (`attempts < 2`), per-user Redis lock + lease renewal, generation rechecks,
  user isolation, normalization/deduplication, and manual/suppression protection.
  Translation keeps the pre-invocation generation authorization check and the
  transactional generation guard, so disabling during classification still
  prevents a translation provider call.

## 2. Schema and migration

Migration `packages/db/migrations/0051_remove_business_quotas.sql` (drizzle-kit
generate, then a hand-added forward-only data-repair block):

- Drops `public_classification_budget` with a plain `DROP TABLE` (no `CASCADE`),
  so an unexpected dependency fails safely instead of being silently dropped.
- Drops `user_personal_tag_preference.quota_date/quota_used/quota_reserved` and
  the two quota checks. Keeps `enabled`, `generation`, the generation
  nonnegative check, and the user foreign key.

Forward-only data repair (runs before the drops):

- `source_record_public_classification_state` rows with
  `last_deferred_reason = 'budget_unavailable'` get `last_deferred_reason = NULL`
  and `next_attempt_at = now()`, so eligible records retry on the next dispatch
  pass.
- `user_personal_tag_run` rows with `state = 'skipped'` and
  `error_code = 'daily_limit_reached'` are requeued (`state = 'queued'`,
  `attempts = 0`, `error_code = NULL`) only when the preference is still enabled,
  the run generation still matches, and the work is still a user-owned, ready
  `user_epub`.
- Remaining obsolete rows keep `state = 'skipped'` but have the removed reason
  replaced: `work_not_eligible` when the preference generation still authorizes,
  otherwise `authorization_expired`.

The existing outbox recovery (`dispatchQueuedPersonalTagRuns`, public
classification dispatcher) re-reads the repaired rows. No runtime
quota-compatibility branch is kept.

## 3. Migration target authorization — pending

Migration `0051` has **not** been applied to any environment. It is an
existing-data schema change and a destructive `DROP`, so it requires explicit
target confirmation and authorization before running. The generation step
connected to no database: it used a harmless placeholder `DATABASE_URL` with
`drizzle-kit generate` only, and the generated `DROP TABLE ... CASCADE` was
narrowed to a plain `DROP TABLE` so an unexpected dependency fails safely.

The migration's data repair was regression-tested by the Supervisor against
connection-local TEMP tables in a verified local `gloaming_test`
(`BEGIN` / `SET LOCAL search_path = pg_temp` / `ROLLBACK`), so no persistent
schema, data, or migration journal was changed. That run **passed**: eligible
requeues; disabled/stale preference → `authorization_expired`; foreign-owner or
not-ready work → `work_not_eligible`; unrelated failed/completed runs and
provider deferrals/fingerprints/`retry_count` unchanged; the budget table and
quota columns removed; and the generation constraint retained.

Read-only migration-state evidence (no database writes): local
`gloaming_backend` has 47 applied journal records with the `0046`
hash/timestamp matching and `0047`–`0051` absent, so an authorized apply there
must first run the pending `0047`–`0050` before `0051`. Local `gloaming_test` has
51 applied journal records with `0046`–`0050` hash/timestamps matching and `0051`
absent. The TEMP-table SQL regression above was rolled back and is not counted as
a persistent migration.

## 4. Rollback limitations and deploy ordering

- **Rollback:** there is no down migration. The dropped table/columns and their
  historical counters cannot be recovered by reverting code. The data repair is
  also not automatically reversible; requeued personal runs may re-invoke the
  provider after a rollback.
- **Deploy ordering:** deploy the quota-free code first (it is compatible with
  both the old and new schema, since it neither reads nor writes the dropped
  columns), then apply migration `0051`. Applying the migration first would break
  an older running backend that still uses the removed table/columns. Run the
  migration before resuming/restarting Workers so the repaired queued rows are
  picked up by the new code.

## 5. Scope and tests

Changed areas: backend discovery classification domain, backend personal tagging
domain/service, `@gloaming/db` schema + migration, web Settings API/page + spec,
`@gloaming/i18n` messages, and the affected review records (annotated
superseded).

Verified in this change (nonpersistent, no database):

- `pnpm typecheck` across shared, i18n, db, backend, and web.
- Targeted ESLint and Prettier on every changed source, spec, i18n, and doc file.
- Settings API spec: 5 tests passed.
- `@gloaming/i18n` tests: 2 files, 9 tests passed.
- Supervisor independently re-ran `pnpm typecheck` across the entire workspace and
  re-ran the Settings API spec (5) and `@gloaming/i18n` (9) — all pass.

Supervisor-provided isolated backend runs (persistent, verified local
`gloaming_test`; no migrations performed):

- First pass, schema `0050`, 5 targeted files: **68 backend tests passed**
  (`tests/unit/domains/discovery/public-classification-policy.spec.ts`,
  `tests/unit/domains/discovery/public-classification-incremental.spec.ts`,
  `tests/functional/domains/discovery/public-classification.spec.ts`,
  `tests/functional/domains/discovery/public-classification-incremental.spec.ts`,
  `tests/functional/domains/library/personal-ai-tagging.spec.ts`). These results
  remain valid for the tests that did not change.
- Final re-run of the changed functional files: **2 files, 37 tests passed**
  (`personal-ai-tagging.spec.ts` 16, `public-classification.spec.ts` 21). The
  strengthened no-daily-gate test completed **52 same-day mocked AI calls** (over
  the former 50/day cap), the personal tagging path completed **11 same-day
  runs**, and the quota-free Settings API response assertion passed.

Not yet verified:

- Migration `0051` has not been applied to any persistent environment, and its
  post-migration persistent runtime is unverified; only the TEMP-table SQL
  regression passed.
- Live Worker/queue runtime behavior, real AI/provider calls, and browser
  acceptance of the quota-free Settings surface were not exercised.
- The 68-test isolated backend run used schema `0050`, not the post-migration
  schema, so the dropped table/columns were not exercised by the new code path in
  a live database.

## 6. Unrelated limits retained

A focused search found no other same-type business daily quota. These remaining
limits are different concerns and were kept: LLM provider balance `used_quota`
introspection (provider accounting), EPUB ingest resource limits, category
candidate/input caps, association caps (0–3 public, 0–3 personal), personal
candidate cap (100), run attempt caps, Redis lock TTLs, and HTTP rate limiting.
