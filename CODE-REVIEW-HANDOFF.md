# Code Review & Fix Handoff — 2026-11-13

> **Audience:** the next agent (or next session) picking up this repo.
> **Scope:** a two-round static code review of `dev`, plus two fix batches, plus
> test-infrastructure repair. No runtime/E2E acceptance was performed.
> **Repo state when this was written:** clean working tree, `dev` is **12 commits
> ahead of `origin/dev`, nothing pushed.** HEAD = `8d8e13f1`.

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
- **Regression tests added:** 4 new specs + 1 extended (26 files / 158 tests).
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

---

## 2. Verification status

Run from the repo root:

| Command             | Result                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`    | ✅ 0 errors (specs now included)                                                                                  |
| `pnpm lint`         | ✅ 0 errors, 3 pre-existing warnings (2 in generated `.cloudflare/types/index.d.ts`, 1 in `commitlint.config.js`) |
| `pnpm format:check` | ✅ clean                                                                                                          |
| `pnpm test`         | ✅ **26 files / 158 tests**                                                                                       |
| `pnpm build`        | ✅ production build succeeds                                                                                      |
| `pnpm db:generate`  | ✅ `No schema changes` (after the script fix)                                                                     |

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

1. **Put `pnpm test` into `.husky/pre-push` (and ideally a CI workflow).**
   `.husky/pre-push` runs `typecheck`, `lint`, `format:check` but **not** `test`,
   and there is **no `.github/` at all**. The suite now takes ~1s, so wiring it up
   costs minutes and is the difference between the baseline being real or
   decorative.
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
3. **Apply migration 0060** — see §6 first.

### 5.2 Correctness issues found in review but NOT fixed

| Severity | Issue                                                                                                                                                                                                                                                                    | Where                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| P1       | Materialization enqueue failure leaves the Work in `uploaded`, and `resolveLinkedWork` only re-enqueues when the status is `failed` + `failedStep=parse`, so one Redis blip makes the record permanently unreachable                                                     | `server/domains/discovery/materialization/service.ts` (`resolveLinkedWork`, `markMaterializationFailedForWork`) |
| P1       | After a crash + stalled redelivery, `claimWorkflowStep` is a no-op while the lease is alive and there is **no** recovery sweep, so a Work can sit in `processing` forever. The comment describing an "admin retry path" was corrected, but the path still does not exist | `server/domains/works/lifecycle/workflow.ts`, `jobs/worker.ts`                                                  |
| P1       | `source-metadata-enrich` returns `{ ok: true }` from its `catch`, so its `attempts: 2` never triggers a retry and failures are invisible in the queue                                                                                                                    | `jobs/source-metadata-enrich.ts`                                                                                |
| P1       | `ensureRetryJobToken` has a read-then-write TOCTOU; on loss it returns `false` and the job ends with `ok: true` having done nothing                                                                                                                                      | `server/application/commands/run-content-parse-workflow.ts`                                                     |
| P1       | `streamAi` still lacks `maxOutputTokens` and `providerScope`, so streaming output is not bounded by model config and resolves models differently from `invokeAi`                                                                                                         | `server/domains/ai/runtime/service.ts`, `runtime/types.ts`                                                      |
| P1       | assist/translate still consume rate-limit quota **before** parsing the body (the new guards were placed after validation; the old ones were not)                                                                                                                         | `app/api/assist/ask/route.ts`, `app/api/translate/part/route.ts`                                                |
| P1       | `assets/[assetId]` returns empty-body 404/403 and checks existence before authorization → `assetId` enumeration oracle                                                                                                                                                   | `app/api/assets/[assetId]/route.ts`                                                                             |
| P1       | `library/discover` maps domain errors by `error.message.startsWith(...)` instead of machine codes                                                                                                                                                                        | `app/api/library/discover/route.ts`                                                                             |
| P1       | `discover/facets` is the only query parameter not validated with zod                                                                                                                                                                                                     | `app/api/discover/facets/route.ts`                                                                              |
| P1       | `recommendations` loads the **entire** public catalog into memory per request, then does `publishedRows.find()` inside a loop (O(n·m))                                                                                                                                   | `server/domains/recommendations/service.ts`                                                                     |
| P1       | Reading history has **no LIMIT**, and status filtering happens in JS after loading every row                                                                                                                                                                             | `server/domains/reading/history/query.ts`                                                                       |
| P1       | Parse finalization still updates `part.meta` one row at a time in a loop (the overwrite was fixed, the loop was not)                                                                                                                                                     | `server/application/commands/run-content-parse-workflow.ts`                                                     |
| P1       | Rate-limit coverage: `/api/works` (50 MB EPUB enqueue), admin test/fetch-models/balance endpoints, `/api/settings/llm/models/[id]/test` are unthrottled                                                                                                                  | `server/infra/http/next-rate-limit.ts` + those routes                                                           |
| P2       | `more-page` treats a synthesized `{status:401}` from `useSession` as "session expired" and pops the login modal for anonymous visitors                                                                                                                                   | `lib/auth/session.ts`, `features/more/more-page.tsx`                                                            |
| P2       | Library search has no debounce and the infinite query lacks `placeholderData: keepPreviousData` → a request storm plus the whole grid flashing empty per keystroke                                                                                                       | `features/library/library-page.tsx`, `library-api.ts`                                                           |
| P2       | Library `status`/`sort`/`view` are never written back to the URL, contradicting the file's own "URL is the durable filter state" comment                                                                                                                                 | `features/library/library-page.tsx`                                                                             |
| P2       | Chapter navigation has no in-flight guard and reuses a stale `expectedRevision` → rapid "next chapter" clicks produce 409 toasts                                                                                                                                         | `features/reader/reader-api.ts`, `reader-page.tsx`                                                              |
| P2       | Two Discover keys are never invalidated: `['discover','related-author']`, `['discover','source-parts']`; the latter also duplicates `readerQueryKey.parts`                                                                                                               | `app/(app)/discover/records/[sourceRecordId]/source-record-detail.tsx`                                          |
| P2       | Rate-limit auth switch is decided by whether `FRONTEND_URL`'s hostname is localhost — a production misconfiguration silently disables all Better Auth rate limiting                                                                                                      | `server/infra/auth/auth.ts`                                                                                     |
| P2       | `health/ready` exposes postgres/redis up-down to anonymous callers                                                                                                                                                                                                       | `app/api/health/ready/route.ts`                                                                                 |
| P2       | Dynamic path params (`[workId]`, `[tagId]`, …) are passed through unvalidated at the transport layer                                                                                                                                                                     | all `app/api/**/[id]` routes                                                                                    |

### 5.3 Frontend performance / structure (not started)

- `features/settings/settings-page.tsx` — 1268 lines, 15 `useState`; `ModelFields`
  is un-memoized so every keystroke re-renders the whole page.
- `features/reader/reader-page.tsx` — effects depend on the `useMutation()`
  return value, which is a fresh object each render, so they re-run every render.
- `features/content/reading-part-view.tsx` — the `useMemo` over chapter HTML is
  defeated by an inline `bilingualData` object literal, re-running DOM parsing +
  DOMPurify per render; `sanitizeHtml` returns **unsanitized** HTML on the
  server path.
- `features/discover/discover-page.tsx` — renders the same grid twice
  (`md:hidden` / `hidden md:block`) with identical props while the component is
  already responsive.
- Polling is scattered per card/row; `LibraryPage` fires two list queries.
- Zero `React.memo` in the repo; many callbacks passed inline defeat future
  memoization.
- `getChapterProgress` reduces the whole manifest every 100ms.

### 5.4 Architecture / duplication (not started)

- **75-route boilerplate** in `app/api` (~40% of its 2504 lines): `getRequestIdentity`
  ×87, `catch → jsonFromThrown` ×90, identical zod `issues.map` ×42. Candidate for
  `withApiHandler` / `requireUser` / `parseOr400`. **Large, mechanical — separate PR.**
- `features/admin/ai/ai-logs-page.tsx` (453) and `tts-logs-page.tsx` (423) are
  structural clones → `<InvocationLogsShell>`.
- LLM instance vs user services are near-verbatim mirrors
  (`llm/config/{providers,models,settings}` vs `llm/config/user/service.ts`).
- `safe-fetch` consolidation across `free-dictionary`, `youdao-dictionary`,
  `provider-introspect`, `materialization/download`, `opds-client`,
  `work-cover-refresh`. **Previously assessed as low value / medium risk and
  deliberately deferred** — the classifications differ per site and the real
  defect (Azure timeout) is already fixed. Revisit or drop explicitly.
- Remaining smaller duplicate groups from the review: truncation helpers (4),
  Intl formatting (7), `SecretField` copy block (5), select option lists (4),
  page loading/error shells (4), ILIKE escaping (2).

### 5.5 Data / schema (partially done)

- Migration 0060 generated but not applied (§6).
- Still open: `reading_work.cover_asset_id` has no FK (blocked by a circular
  Drizzle type reference), `content_asset.kind/status` have no authoritative
  enum so no CHECK is possible, `dictionary_entry_word` has a redundant
  non-unique index next to its unique one, `reading_work` → `reading_state` etc.
  still allow application-level drift where no CHECK exists.

### 5.6 Dead / misleading mechanisms (documented, not removed)

- Workflow `metadata` step, `stepRunningStatus`, `rotateWorkflowJobToken` have no
  callers in the live tree.
- `user_personal_tag_run` table has no live consumer (only `archive/`).
- `completeUserTagTranslations` authorization/preference branches are never
  reached (no caller passes `authorizationGeneration`).
- Three TTS error codes in `server/domains/tts/synthesis/service.ts` are
  unreachable because the resolver already filters unusable configs.

### 5.7 i18n and dependencies (not started)

- **34 lines of hardcoded Chinese in `shared/`** (5 files) render directly in the
  en-US UI: `shared/reading-stats` difficulty labels → `"Difficulty: 入门"`;
  `shared/llm/wire-registry.ts` labels/descriptions used by the settings page
  (while the admin page uses i18n → same entity, two different labels);
  `shared/llm/balance-endpoint.ts` messages; zod messages in `shared/llm/llm-config.ts`.
- `i18n/messages/zh-CN.json` has ~40 keys identical to en-US, ~14 of them real
  untranslated copy (`"The Reality"`, `"Max tokens"`, `"Region"`, …) — and
  `zh-CN` is `DEFAULT_LOCALE`.
- `shared/` and `server/db/schema.ts` define 6 duplicate contracts
  (`ContentAssetMeta`, `SourceRecordAuthor/SourceMeta/ContentCandidate/Availability`,
  `WorkStatsProvenance`) reconciled with `as`, so field drift is invisible to the
  type system. `shared/content-assets` has zero production consumers.
- Dependency hygiene (each is a one-liner): `shadcn` is a runtime dependency but
  is CLI-only; `@types/dompurify` is a deprecated stub; `@cloudflare/workers-types`
  is declared but never referenced (Workers typechecking is therefore **not** on);
  `date-fns` has no direct usage; `react-server-dom-webpack` should be pinned to
  `19.3.1` like `react`; `.npmrc`'s two settings are ignored by pnpm 11 (verified
  `pnpm config get` returns `undefined`) and belong in `pnpm-workspace.yaml`.

### 5.8 Documentation drift (not started)

- `docs/deployment.md` still describes the legacy `web`/`api`/`worker`
  three-service topology and `API_INTERNAL_URL`, which contradicts the current
  single-package root layout.
- `server/infra/config/env-common.ts` comment still says "start Jobs from `client/`".
- A stray `tsconfig.nocf.tsbuildinfo` exists with no matching `tsconfig.nocf.json`.

---

## 6. Before applying migration 0060

File: `server/db/migrations/0060_natural_robbie_robertson.sql`.
**It has never been executed.** Run `pnpm db:migrate` only after confirming:

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

Take a backup first. This migration was explicitly scoped to "generate only".

---

## 7. Commands

```bash
pnpm typecheck     # tsc --noEmit (now includes *.spec.ts)
pnpm lint          # eslint
pnpm format:check  # prettier
pnpm test          # vitest run  → 26 files / 158 tests
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
- Do not change core business semantics without task authorization (this is why
  `recommendations` LIMIT and reading-history LIMIT were left open rather than
  decided unilaterally).
