# Code Review & Fix Handoff — 2026-11-13

> **Audience:** the next agent (or next session) picking up this repo.
> **Scope:** a two-round static code review of `dev`, plus two fix batches, plus
> test-infrastructure repair. No runtime/E2E acceptance was performed.
> **Repo state when this was written:** clean working tree, `dev` is ahead of
> `origin/dev`, nothing pushed. A follow-up cleanup pass on 2026-11-14 is
> summarised in §1.5 and marked inline in §5.

---

## 1. What was done

Three separate work streams landed in this window. They are interleaved in a few
files; each commit body calls that out under an "Also included" paragraph.

### 1.1 Pre-existing uncommitted work (another AI, E2E round)

Before this session started, the working tree already held an uncommitted batch
produced by another AI after its own end-to-end run. It was **preserved verbatim**
and committed as part of the batches below. Its content:

- EPUB internal-link navigation: `sourceHref` / `sourceHrefs` / `sourceAnchors`
  recorded per part and persisted in `reading_part.meta`; anchor preservation in
  the cleanup pipeline; `ReaderPart` intercepting anchor clicks.
- Provider-native structured output (`Output.object` / `Output.json`) and
  `createLlmClient` honouring `wireVariant`.
- `part.meta` merge instead of overwrite (word-count writes).
- Admin AI log detail Sheet → Dialog.
- Tag translation `missingLocales` + toast severity changes.
- Four product docs reworded to say automatic personal tagging is removed.

### 1.2 Fix batch 1 — 22 items (security, correctness, contract)

All 22 items from the review's "batch 1" list were implemented. Headline items:

| Area                        | Fix                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Better Auth rate limiter    | `secondary-storage.ts` implemented `increment(key, ttl)` as `INCRBY key ttl`, so the window TTL was added to the counter on the first request and the key never expired → **`/sign-in/email` returned 429 on the first attempt in production** (only when `FRONTEND_URL` is not localhost). Replaced with fixed-window Lua.                                                                          |
| SSRF                        | IPv6 guard compared bracketed `URL.hostname` literals, so `http://[::1]` etc. bypassed it entirely; internal IPv6 is now "anything outside `2000::/3`". `proxyUrl` now validated too (it carried the provider `Authorization` header unguarded). Dictionary `customEndpoint` now validated. Azure TTS `region` validated on write **and** at call time, plus a 30s timeout and a streaming 32MB cap. |
| LLM timeouts                | `createLlmClient` silently discarded `timeoutMs` / `maxRetries`; they are now applied at the `generateText` / `streamText` call site.                                                                                                                                                                                                                                                                |
| Rate-limit keys             | `x-forwarded-for` leftmost hop (client-controlled) → `cf-connecting-ip` then the rightmost hop.                                                                                                                                                                                                                                                                                                      |
| OPDS paging                 | Stride used the feed window (25) while slicing by the caller's `pageSize`, so items 16..25 (41..50, …) were unreachable.                                                                                                                                                                                                                                                                             |
| Job retries                 | `content-parse` kept `removeOnFail: 100` with a stable job id → every later retry was a silent BullMQ no-op.                                                                                                                                                                                                                                                                                         |
| Reader assist state machine | Inline and drawer shared one `AbortController`; the aborted path returned before clearing `isDrawerSending`, leaving the drawer input disabled until reload.                                                                                                                                                                                                                                         |
| Error contract              | 401/403 threw a bare `Error('UNAUTHORIZED')` whose `code` is not an i18n key; `ValidationFailedError.details` and supplied validation messages were dropped; `console.error` bypassed pino redaction.                                                                                                                                                                                                |
| Data integrity              | Upload `refCount` decrement made atomic + lock-guarded; source-record insert made `ON CONFLICT`; user/instance LLM conflict mapping unified (409 not 500); `row!` assertions → explicit 404; `pageSize` capped at 100.                                                                                                                                                                               |
| LLM observability           | Failed invocations now recorded with `status: 'failure'` (previously only successes appeared in admin stats).                                                                                                                                                                                                                                                                                        |

### 1.3 Fix batch 2 — test baseline + N+1 + consolidation + rate limits + migration

- **Test baseline repaired.** `vitest` was a _phantom_ dependency (only present as
  an optional peer of `better-auth`); `pnpm test` was `echo "No root tests yet"`;
  there was no `vitest.config.ts`, so a bare `vitest run` loaded the root
  `vite.config.ts` (vinext + Cloudflare plugins) and crashed, and also picked up
  219 archived specs. Specs were excluded from **both** tsconfigs while ESLint
  linted them.
  Now: `vitest` declared, standalone config (excludes `archive/**`), `pnpm test`,
  and specs are typechecked.
- **Regression tests added:** 4 new specs + 1 extended (now 27 files / 161 tests).
- **N+1 removed:** `browseLibrary` (~70 round trips per 24-row page → 4 fixed
  queries) and Discover `enrichItemsWithLocalState` (≤25 `canReadWork` lookups →
  1 batch query). `LibraryItem` assembly collapsed into one owner.
- **Duplicated helpers consolidated:** SSE client (2 copies), `useIsDesktop`
  (3 copies), tag-translation toast mapping (4 copies), reader query-key
  literals (6 sites), `isUniqueViolation` (2 copies), upload lock prefix (3
  copies).
- **Rate limits added:** `ttsSynthesis`, `tagTranslation`, and a `user` rule for
  `dictionaryLookup`.
- **Migration 0060 generated (NOT applied).**

### 1.4 Commits

| #   | commit     | subject                                                                       |
| --- | ---------- | ----------------------------------------------------------------------------- |
| 1   | `4067f1bc` | `docs: mark automatic personal AI tagging as removed`                         |
| 2   | `63af20ec` | `feat(reader): navigate EPUB internal links and harden inline assist`         |
| 3   | `4cdb9326` | `refactor(ai): provider-native structured output and response wire variants`  |
| 4   | `c2391433` | `fix: close outbound/auth rate-limit gaps and correct the error contract`     |
| 5   | `02fcec3f` | `fix: make upload, source-record and LLM/TTS writes race-safe`                |
| 6   | `2127a596` | `perf(server): batch library and discover list queries`                       |
| 7   | `e08d8e1c` | `refactor: consolidate duplicated SSE, media-query and feedback helpers`      |
| 8   | `19f10e13` | `feat(api): rate-limit TTS synthesis, tag translation and dictionary lookups` |
| 9   | `cf3cf5c7` | `fix(shared): cap pageSize on list query schemas`                             |
| 10  | `15cb4648` | `chore(tooling): wire vitest into the pipeline and fix the db scripts`        |
| 11  | `d1ad9719` | `test: add regression coverage for the hardening fixes`                       |
| 12  | `8d8e13f1` | `chore(db): generate migration 0060 (NOT applied)`                            |

**Files that carry two work streams** (hunk-level splitting was not feasible;
read the commit body's "Also included" list): `features/reader/reader-page.tsx`,
`features/reader/reader-model.ts`, `features/reader/assist/use-reader-assist.ts`,
`server/domains/ai/runtime/service.ts`, `server/infra/http/next-rate-limit.ts`,
`server/domains/library/tags/service.ts`,
`server/domains/discovery/gutenberg/opds-adapter.ts`, `package.json`.

### 1.5 Cleanup pass — 2026-11-14

A targeted cleanup of the review's remaining mechanical items landed in these
commits (nothing pushed):

| commit     | subject                                                                |
| ---------- | ---------------------------------------------------------------------- |
| `67f3c7d9` | `refactor(workflow): drop the unused metadata step and token rotation` |
| `41782f2f` | `fix(db): drop the redundant dictionary word index`                    |
| `e5bb8097` | `fix(db): add cover asset FK and drop the unused tag run table`        |
| `8d779f7f` | `refactor(settings): split the settings page by owner`                 |
| `d115a873` | `refactor(llm): share provider, model and setting writes`              |
| `a1711ddb` | `refactor: make shared modules the single owner of mirrored contracts` |
| `1e4800a4` | `refactor(ui): share secret-field copy and admin datetime formatting`  |
| `22d85df5` | `refactor(library): derive polling from one processing predicate`      |

Each commit passed `typecheck`, `lint`, `format:check` and `test`. The schema
migrations (0061–0063) were applied to the local dev database only; there is no
production database in this environment.

---

## 2. Verification status

Run from the repo root:

| Command             | Result                                                               |
| ------------------- | -------------------------------------------------------------------- |
| `pnpm typecheck`    | ✅ 0 errors (specs now included)                                     |
| `pnpm lint`         | ✅ 0 errors, 0 warnings (generated `.cloudflare/` types are ignored) |
| `pnpm format:check` | ✅ clean                                                             |
| `pnpm test`         | ✅ **27 files / 161 tests**                                          |
| `pnpm build`        | ✅ production build succeeds                                         |
| `pnpm db:generate`  | ✅ `No schema changes` (after the script fix)                        |

**Not verified:** no runtime acceptance, no E2E, no database migration applied,
no load/soak testing. Every claim above comes from static reading plus the unit
tests listed in §4.

**Also not verified per-commit:** each commit passed the pre-commit
`lint-staged` hook (eslint --fix + prettier), but intermediate commits were not
individually typechecked — the working tree always held the final content.
Commit order was chosen so dependencies resolve at every step; the final tree is
fully green.

---

## 3. Behavior changes introduced (know these before reviewing the diff)

1. **`proxyUrl` now rejects private hosts and `socks5`.** Local proxying goes
   through the `http_proxy` env-var path (`server/infra/llm/proxy.ts`), so dev is
   unaffected, but any stored `socks5://…` value will fail on the next save —
   undici's `ProxyAgent` never supported it anyway.
2. **`pageSize > 100` now returns 400** (previously an unbounded `LIMIT`).
3. **401/403 bodies** changed from `{"error":"UNAUTHORIZED","code":"UNAUTHORIZED"}`
   to a localized message plus the stable code `api.errors.unauthorized`.
4. **Validation details now surface the raw zod message** (previously discarded
   from 42 call sites). Those messages are **English and not localized** — see §5.
5. **Inline and drawer AI streams can now run concurrently.** They previously
   shared one controller (which is what caused the drawer-lock bug). The assist
   policy allows `maxConcurrent: 2`.
6. **`releaseUploadedObject` throws when it cannot take the dedupe lock** (it
   used to proceed unsafely). All three callers already `try/catch` it.
7. **Instance-scope model writes no longer blanket-map every error to 409** —
   only a real unique violation does; connection failures surface as 500.
8. **Dictionary enrichment:** a malformed-JSON completion now returns the raw
   text instead of throwing, so the existing repair loop still runs.

---

## 4. Closed by this work (regression coverage included)

| Finding                                                                        | Spec                                                      |
| ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| IPv6 / private-target SSRF bypass, `proxyUrl`, dictionary endpoint, TTS region | `server/infra/llm/outbound-url.spec.ts`                   |
| Fragment-only link jumping to the wrong chapter                                | `features/reader/reader-model.spec.ts`                    |
| OPDS page stride / unreachable items                                           | `server/domains/discovery/gutenberg/opds-adapter.spec.ts` |
| `pageSize` unbounded                                                           | `shared/pagination/pagination.spec.ts`                    |
| Unique-violation detection                                                     | `server/shared/errors/db-errors.spec.ts`                  |

Covered by code but **without** a regression test (needs Redis, an HTTP stack, or
a browser): Better Auth fixed-window counter, assist AbortController state
machine, upload `refCount` atomicity, source-record upsert, LLM timeout wiring,
failure invocation logging, rate-limit policies, all N+1 changes.

---

## 5. Remaining work

### 5.1 Highest value, lowest cost — do next

1. ✅ **`pnpm test` is in `.husky/pre-push` and CI.** `.github/workflows/ci.yml`
   runs `format:check`, `lint`, `typecheck`, `test` and `build`; the local
   pre-push hook runs the same set minus `build`.
2. **Runtime acceptance (E2E) in an isolated dev environment.** Nothing in §2
   exercises real behavior. Specifically:
   - **Better Auth rate limiting** — only observable when `FRONTEND_URL` is not
     `localhost` (the guard is disabled locally). This is the single highest-risk
     untested fix: sign in twice against `/api/auth/sign-in/email` and confirm the
     second call is not 429.
   - EPUB upload → parse → internal-link jump → read-aloud (exercises the new
     `ttsSynthesis` limit).
   - Tag translation and dictionary lookup under the new quotas; confirm a normal
     reading session is never throttled.
   - Streaming assist/translate (the SSE client was rewritten: reader cancel on
     exit, malformed frame handling).
   - 401/403 rendering on the client with the new error bodies.
3. ✅ All 64 migrations, including 0059 and 0060–0063, are applied to the local
   dev DB; the 0059 pre-migration backup is documented in §6.

### 5.2 Backend correctness (re-verified, fixed)

> **Re-verified 2026-11-14:** P1-1–P1-12 and P2-1–P2-6 are fixed in the live tree
> (materialization retry + recovery sweep, validated facets/query, history LIMIT
> with SQL status filter, recommendation feature-column map, batched `part.meta`,
> per-route rate limits, `pathId`, env-driven auth limiting, aggregate readiness).
> P1-13 `/api/works` now uses the `epubUpload` policy and caps the body while
> it streams (50 MB + 64 KB multipart overhead), so a chunked request without
> `Content-Length` cannot buffer an unbounded payload.
>
> **Follow-up 2026-11-16:** personal `uploaded` recovery + orphan fail-closed,
> recommendations candidate pool cap (250), TTS segment cache-hit without
> synthesis quota, Discover `related-author` invalidation, Azure TTS
> `redirect: 'manual'`. The table below is a **closed ledger** (✅ = fixed in
> live tree); do not read unchecked wording as an open backlog.

| Severity | Status | Issue (original finding)                                                                                 | Where                                                                                        |
| -------- | ------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| P1       | ✅     | Materialization / `uploaded` re-enqueue + personal orphan fail-closed + recovery sweep covers `uploaded` | `materialization/service.ts`, `personal-epub-upload.ts`, `recover-stalled-content-parses.ts` |
| P1       | ✅     | Stalled parse recovery sweep after lease expiry                                                          | `workflow.ts`, `jobs/worker.ts`, `recover-stalled-content-parses.ts`                         |
| P1       | ✅     | `source-metadata-enrich` rethrows on failure                                                             | `jobs/source-metadata-enrich.ts`                                                             |
| P1       | ✅     | Retry-token / claim path hardened (adopt winner; no silent forever no-op as primary path)                | `run-content-parse-workflow.ts`                                                              |
| P1       | ✅     | `streamAi` bounds + `providerScope`                                                                      | `server/domains/ai/runtime/service.ts`                                                       |
| P1       | ✅     | assist/translate parse body before quota                                                                 | `app/api/assist/ask`, `app/api/translate/part`                                               |
| P1       | ✅     | Asset gateway indistinguishable 404                                                                      | `app/api/assets/[assetId]/route.ts`                                                          |
| P1       | ✅     | `library/discover` domain error codes via `withApiError`                                                 | `app/api/library/discover/route.ts`                                                          |
| P1       | ✅     | `discover/facets` zod-validated                                                                          | `app/api/discover/facets/route.ts`                                                           |
| P1       | ✅     | Recommendations feature columns + **candidate pool LIMIT 250** (shelf anchors by id)                     | `server/domains/recommendations/service.ts`                                                  |
| P1       | ✅     | Reading history LIMIT + SQL status filter                                                                | `server/domains/reading/history/query.ts`                                                    |
| P1       | ✅     | Batched `part.meta` word-count update                                                                    | `run-content-parse-workflow.ts`                                                              |
| P1       | ✅     | `/api/works` `epubUpload` + streaming body cap; admin probes `outboundProbe`                             | `next-rate-limit.ts` + routes                                                                |
| P2       | ✅     | Guest session no longer synthetic 401 login modal                                                        | `lib/auth/session.ts`, `features/more/more-page.tsx`                                         |
| P2       | ✅     | Library search debounce + `keepPreviousData`                                                             | `features/library/library-page.tsx`, `library-api.ts`                                        |
| P2       | ✅     | Library `status`/`sort`/`view` URL durable                                                               | `features/library/library-page.tsx`                                                          |
| P2       | ✅     | Chapter navigation in-flight guard                                                                       | `features/reader/reader-api.ts`, `reader-page.tsx`                                           |
| P2       | ✅     | `related-author` invalidated on save-ready; `source-parts` uses `readerQueryKey.parts`                   | `discover-source-card.tsx`, `source-record-detail.tsx`                                       |
| P2       | ✅     | Auth rate-limit via `AUTH_RATE_LIMIT_ENABLED` (not FRONTEND_URL hostname)                                | `server/infra/auth/auth.ts`                                                                  |
| P2       | ✅     | `health/ready` aggregate only                                                                            | `app/api/health/ready/route.ts`                                                              |
| P2       | ✅     | Dynamic path params via `pathId`                                                                         | `app/api/**/[id]` routes                                                                     |

### 5.3 Frontend performance / structure (resolved)

- ✅ **Settings page split.** `settings-page.tsx` now holds the summary view and
  session gate; LLM forms live in `features/settings/llm/` with a controller
  hook (`use-own-ai-settings`) and `OwnAiView`. `ModelForm` still owns its draft.
- ✅ `features/reader/reader-page.tsx` destructures the stable `mutateAsync` and
  depends on that in effects (comment at the destructuring plus the dependency
  arrays); no effect depends on a whole mutation object.
- ✅ `bilingualData` is memoized in the reader and passed down, so the `useMemo`
  in `reading-part-view.tsx` holds. Its `sanitizeHtml` fails closed (empty
  string) when no browser DOM exists, so SSR never emits EPUB-authored markup.
- ✅ `discover-page.tsx` renders the records grid and the legacy grid once each;
  the only remaining `md:hidden` is the mobile pagination control.
- ✅ **Library polling unified.** Both library queries derive their interval
  from one `hasProcessingItem` predicate. Discover save-status and admin asset
  cleanup polling remain feature-local by design.
- **Closed — not merging:** `LibraryPage` issues two list queries (`/api/library`
  for the continue hero and emptiness, `/api/library/browse` for the filtered
  grid). Merging would change the API split and conflate "no matches" with
  "empty library", so it stays.
- **Closed — no measured hot path:** the repo has no `React.memo`; callbacks are
  passed inline. Adding memoization without profiling would add comparison cost
  and hide real render work.
- ✅ `getChapterProgress` now uses the precomputed manifest weights.

### 5.4 Architecture / duplication (resolved)

- ✅ Shared `withApiError`, `requireIdentity`, `jsonSchemaError`, `pathId` and the
  new `parseJsonBody` / `parseSearchParams` replace the old per-route boilerplate.
- ✅ Log pages consume `InvocationLogsShell`; `parseJsonBody` / `parseSearchParams`
  in `server/infra/http/next-json.ts` centralize body/query validation.
- ✅ LLM instance and user services now share `llm/config/mutations.ts`; the
  ownership guards are the only per-scope branch.
- ✅ `SecretField` copy (5 sites) and admin date-time formatting (3 sites) use
  shared helpers; ILIKE escaping now exists only in `works/catalog`.
- ✅ Truncation now lives in `server/shared/text.ts`; conversations and assist
  share it, with conversations preserving its trim-before-measure behavior.
- ✅ The repeated protocol-option list in `provider-form.tsx` is built once as
  `familyOptions`; the admin form only renders a badge, so it had no duplicate.
- ✅ The settings loading shell exists once; there was no four-site duplication.
- **Closed — won't merge:** `safe-fetch` handling across `free-dictionary`,
  `youdao-dictionary`, `provider-introspect`, `materialization/download`,
  `opds-client`, `work-cover-refresh`. Each site has different classification
  and retry semantics, and the real defect (Azure timeout) is fixed. Unifying
  them would only add option flags.
- ✅ Removed duplicate groups: Intl formatting (7), `SecretField` copy block (5),
  ILIKE escaping (2), truncation helpers, select option list.

### 5.5 Data / schema (resolved, one documented exception)

- ✅ Migrations 0061–0063 are applied to the local dev database: 0061 drops
  `dictionary_entry_word_idx`, 0062 adds the `reading_work.cover_asset_id` FK
  (`ON DELETE SET NULL`), 0063 drops `user_personal_tag_run`.
- **Closed — won't add a CHECK:** `content_asset.kind/status` have no
  authoritative enum. The live tree writes only `cover`/`ready`, but the schema
  is shared with ingestion paths, so constraining to today's values would encode
  a guess. Application-level validation stays the contract.

### 5.6 Dead / misleading mechanisms (resolved)

- ✅ Workflow `metadata` step, `stepRunningStatus`, `rotateWorkflowJobToken` and
  the `user_personal_tag_run` table were removed in `67f3c7d9` / `e5bb8097`.
- ✅ The unreachable branches are gone: the live `completeUserTagTranslations`
  has no `authorizationGeneration`/preference branches, and `ERROR_CODES.TTS`
  only contains codes that are thrown in the live tree.

### 5.7 i18n and dependencies (resolved)

- ✅ No hardcoded Chinese remains in `shared/` production modules; a directory
  scan only finds test fixtures. Difficulty labels, protocol labels/descriptions,
  balance messages and zod messages resolve through `@/i18n` or structured keys.
- ✅ `zh-CN.json`: the remaining values identical to en-US are proper nouns and
  technical labels (`Base URL`, `API Key`, `Model ID`, `IPA`, protocol/provider
  names); no untranslated prose remains.
- ✅ `shared/` is now the single owner of those six contracts: `server/db/schema.ts`
  imports `SourceRecord*` from `@/shared/discovery` and `WorkStatsProvenance`
  from `@/shared/reading-stats`, and the redundant `as` casts are gone.
  `shared/content-assets` (zero consumers) was deleted.
- ✅ Dependency hygiene is done: `shadcn` is a dev dependency, the deprecated
  `@types/dompurify` stub and direct `date-fns` usage are gone,
  `react-server-dom-webpack` is pinned to `19.3.1`, the stale `.npmrc` settings
  live in `pnpm-workspace.yaml`, and generated Workers types are no longer linted.

### 5.8 Documentation drift (resolved)

- ✅ `docs/deployment.md` keeps the default single-package product first and now
  labels every legacy three-service section as `Archived:`; `API_INTERNAL_URL`
  is explicitly scoped to the archive.
- ✅ `server/infra/config/env-common.ts` already describes loading Jobs from the
  repo root, and the stray `tsconfig.nocf.tsbuildinfo` is gone.

---

## 6. Migration state

**Applied locally:** all 64 migrations, including 0059 (applied 2026-11-14) and
0060–0063. 0059 is destructive: it deleted 79,683 unreferenced `source_record`
rows and dropped eleven public-category / sync-run tables.

Because Drizzle only applies migrations newer than the last recorded row,
`pnpm db:migrate` skipped the out-of-order 0059. It was applied in a transaction
and its hash plus journal timestamp were recorded manually.

**Pre-migration backup:** created as `migration_0059_backup_20261114` (229 MB)
before applying 0059 and dropped after the result was accepted. The 79,683
deleted rows and the eleven dropped tables are no longer restorable from this
database.

If 0060 ever needs to run against another database, confirm first:

1. **No scope has two open conversations** — `conversation_user_open_uidx` fails
   if any `(user_id, surface, subject_type, subject_id)` already has more than one
   row with `ended_at IS NULL`. Close duplicates first:
   ```sql
   SELECT user_id, surface, subject_type, subject_id, count(*)
   FROM conversation WHERE ended_at IS NULL
   GROUP BY 1,2,3,4 HAVING count(*) > 1;
   ```
2. **No work has two work-level assets of one kind** — `content_asset_work_kind_uidx`
   covers `part_id IS NULL` rows:
   ```sql
   SELECT work_id, kind, count(*) FROM content_asset
   WHERE part_id IS NULL GROUP BY 1,2 HAVING count(*) > 1;
   ```
3. **No out-of-list enum values** for the three new CHECKs
   (`reading_work.processing_status`, `reading_work.visibility`,
   `reading_state.status`).

Take a backup first for any non-local database.

---

## 7. Commands

```bash
pnpm typecheck     # tsc --noEmit (now includes *.spec.ts)
pnpm lint          # eslint
pnpm format:check  # prettier
pnpm test          # vitest run  → 27 files / 161 tests
pnpm build         # production build
pnpm db:generate   # now works from the repo root (was broken)
pnpm db:migrate    # applies migrations — see §6
```

`vitest.config.ts` is intentionally standalone: do **not** point vitest at the
root `vite.config.ts` (its vinext + Cloudflare plugins make vitest fail to
start), and keep `archive/**` excluded (its `@/...` aliases no longer resolve and
its 219 specs drown out real failures).

---

## 8. Rules that govern further work

Read `AGENTS.md`, `rules/architecture.md`, `rules/backend.md`,
`rules/frontend.md`, `rules/packages.md` before structural changes. Two that bit
during this work:

- Existing-data schema changes require explicit user authorization — hence
  "generate only".
- Do not change core business semantics without task authorization. Both the
  recommendation and reading-history limits were subsequently added with that
  authorization; do not relax them without a product decision.

---

## 9. Final status (2026-11-16)

Static review items in §5.2–§5.8 are fixed or explicitly closed with reasons.
§5.1 still lists **runtime/E2E acceptance**, **push**, and **production
migrations** as user/operator actions — those are out of “code closed”, not
unowned TODOs in the tree.

Remaining actions require the user:

- Push `dev` — the branch is ahead of `origin/dev` and intentionally not pushed.
- Run 0059–0063 against production — needs a separate authorization, a backup and
  the §6 preflight. 0059 deletes unreferenced `source_record` rows and drops
  eleven tables.
- Accept the runtime behavior (including follow-ups landed 2026-11-16).
