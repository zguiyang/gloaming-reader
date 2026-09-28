# User-first architecture — implementation plan

**Status:** Active
**Last updated:** 2026-09-28
**SSOT:** [`docs/adr/001-reading-content-domain-model.md`](../adr/001-reading-content-domain-model.md) (User-first amendment)
**Vocabulary:** [`docs/product/engineering-vocabulary.md`](../product/engineering-vocabulary.md)

This plan decomposes the User-first epic into atomic tasks. Dependency order across layers:

```text
db → shared → backend → tests → web
```

Locked epic phase order (PR slicing must follow this; do not reorder Library before Catalog/Ingest):

```text
Schema → Access → Publication → Catalog/Ingest → Library → Provider → Settings → closeout
```

Technical layer order within each phase remains `db → shared → backend → tests → web`.

---

## Epic acceptance

**Legacy Remaining = 0** (closeout gate):

- No `Article` / `reading_progress` / `article_audio` in active routes, shared contracts, or admin UX copy as engineering identifiers.
- No `reading_work.status` column or API field mixing pipeline and publication.
- Admin catalog lives only at **`/admin/catalog/works`** and **`/api/admin/catalog/works`** (legacy `/admin/works` removed).
- Library membership is not inferred solely from `reading_state`; My Library follows ADR union semantics.
- Documented open items in this plan are **closed** or explicitly deferred with an ADR decision.

---

## PR-01 — schema foundation (branch: `codex/user-first-pr01-schema-foundation`)

### Done (evidence in tree — verify with commands below)

| Item                                               | Evidence                                                                                                                                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration `0036_user_first_pr01_schema_foundation` | `packages/db/migrations/0036_user_first_pr01_schema_foundation.sql` — `user_library_item`, `processing_status`, drops `status`, `owner_user_id` on LLM/TTS tables, library backfill from `reading_state` |
| Drizzle schema                                     | `packages/db/src/schema.ts` — `processingStatus`, `userLibraryItem`, provider `ownerUserId`                                                                                                              |
| Shared work contracts                              | `packages/shared/src/works/works.ts` — `WORK_PROCESSING_STATUSES` (six values), `publishedAt`, `adminWorkListQuery` `processingStatus` + `publicationStatus`                                             |
| Shared unit tests                                  | `packages/shared/src/works/works.spec.ts`                                                                                                                                                                |
| Backend domain migration to `processingStatus`     | Modified paths under `apps/backend/src/domains/works/**`, `apps/backend/src/application/commands/*`, jobs, shelf, recommendations, assets, metadata, etc. (see branch diff)                              |
| Admin read/list filters                            | `apps/backend/src/domains/works/admin/admin-work-read.ts` — `publicationStatus` + `processingStatus`                                                                                                     |
| Web admin work model                               | `apps/web/features/admin/works/works-model.ts` — `isWorkPublished`, TTS workflow helpers, list query mapping                                                                                             |
| Web admin API client                               | `apps/web/features/admin/works/works-api.ts` — still calls `/api/admin/works` (path rename **not** done)                                                                                                 |
| Functional regression updates                      | e.g. `apps/backend/tests/functional/domains/works/works-epub.spec.ts` (publication + processing filters)                                                                                                 |
| PR-01 DB constraint tests                          | `apps/backend/tests/functional/domains/db/user-first-pr01-schema-constraints.spec.ts` — unique `(user_id, work_id)`, provider/setting/TTS scope indexes                                                  |

**Verification (2026-09-28 independent review on this branch; `gloaming_test` via `pnpm db:migrate:test`):**

| Check                                                                                                                                                                | Result                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm typecheck:shared`, `typecheck:backend`, `typecheck:web`                                                                                                        | pass                                                                                         |
| `pnpm lint:shared`, `lint:backend`, `lint:web`                                                                                                                       | pass (one pre-existing `@next/next/no-img-element` **warning** in web; **no** ESLint errors) |
| `pnpm db:migrate:test`                                                                                                                                               | full migration including `0036_user_first_pr01_schema_foundation` applied                    |
| `pnpm --filter @gloaming/shared test -- src/works/works.spec.ts`                                                                                                     | **14/14** pass                                                                               |
| `pnpm --filter @gloaming/backend test -- tests/functional/domains/db/user-first-pr01-schema-constraints.spec.ts`                                                     | **4/4** pass                                                                                 |
| `pnpm --filter @gloaming/backend test -- tests/functional/domains/works/works-epub.spec.ts`                                                                          | **19/19** pass                                                                               |
| Focused backend functional regression set (works, ingest, metadata, LLM, assets, taxonomy, translate, dictionary)                                                    | **13 files / 97 tests** pass on `gloaming_test`                                              |
| `pnpm --filter @gloaming/web test -- features/admin/works/works-model.spec.ts features/book-detail/book-detail-model.spec.ts features/discover/discover-api.spec.ts` | **33/33** pass (3 files)                                                                     |
| `pnpm typecheck`, `pnpm test`, `pnpm lint` (full monorepo)                                                                                                           | **open** — not run as part of this review                                                    |

Re-run locally:

```bash
pnpm typecheck:shared && pnpm typecheck:backend && pnpm typecheck:web
pnpm lint:shared && pnpm lint:backend && pnpm lint:web
pnpm db:migrate:test
pnpm --filter @gloaming/shared test -- src/works/works.spec.ts
pnpm --filter @gloaming/backend test -- tests/functional/domains/db/user-first-pr01-schema-constraints.spec.ts
pnpm --filter @gloaming/backend test -- tests/functional/domains/works/works-epub.spec.ts
pnpm --filter @gloaming/web test -- features/admin/works/works-model.spec.ts features/book-detail/book-detail-model.spec.ts features/discover/discover-api.spec.ts
```

### Open / in progress (PR-01 or immediate follow-ups)

| Item                                         | State                         | Notes                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin route rename                           | **open**                      | Web: `apps/web/app/admin/works/**`; API: `/api/admin/works`. Target: `/admin/catalog/works`, `/api/admin/catalog/works`.                                                                                                                                                                                    |
| Library APIs & shelf union                   | **open**                      | `user_library_item` not referenced in `apps/backend/src/**`; `getShelf` still `reading_state`-only (`apps/backend/src/domains/shelf/service.ts`).                                                                                                                                                           |
| Admin “busy” tab vs TTS (Catalog/Ingest)     | **open** — known taxonomy gap | `adminWorksListQueryForFilter('busy')` requests `processingStatus` including `ready`; `filterAdminWorksListItems` drops idle `ready` rows client-side (`works-model.ts`, `works-model.spec.ts`). Server/client classification mismatch — **not** PR-01 scope; tracked under **C2** in Catalog/Ingest phase. |
| User read access (private / user-owned Work) | **open**                      | No dedicated authorization boundary task landed; see **AC1–AC2** (Access phase).                                                                                                                                                                                                                            |
| Legacy Remaining audit                       | **open**                      | No automated “Remaining = 0” gate in repo; closeout task below.                                                                                                                                                                                                                                             |

---

## Atomic tasks

Each task lists **scope**, **prerequisites**, **done when**, and **checks**.

### A. Publication vs processing semantics (Publication phase — largely PR-01)

#### A1 — Lock publication vs processing in shared (PR-01)

|                   |                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------- |
| **Scope**         | `WORK_PROCESSING_STATUSES`, work/admin DTOs, list query `publicationStatus`           |
| **Prerequisites** | ADR User-first amendment                                                              |
| **Done when**     | Zod rejects `published` as `processingStatus`; admin list accepts `publicationStatus` |
| **Checks**        | `pnpm --filter @gloaming/shared test -- src/works/works.spec.ts`                      |

**Status:** **done** (**14/14** `works.spec.ts`, 2026-09-28).

#### A2 — Backend publish/unpublish uses `published_at` only

|                   |                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------- |
| **Scope**         | `admin-work-write`, lifecycle workflow terminal states, catalog discover filters            |
| **Prerequisites** | A1, DB migration applied                                                                    |
| **Done when**     | No code writes `published` to a status column; publish sets `published_at`                  |
| **Checks**        | `pnpm --filter @gloaming/backend test -- tests/functional/domains/works/works-epub.spec.ts` |

**Status:** **done** on branch (**19/19** on `gloaming_test`, 2026-09-28).

#### A3 — Idempotent admin publish (Publication phase — PR-03)

|                   |                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Scope**         | `apps/backend/src/domains/works/admin/admin-lifecycle.ts` — `publishWork` only (no new publication fields/helpers/services)          |
| **Prerequisites** | A2                                                                                                                                   |
| **Done when**     | Repeat `POST …/publish` returns 200 without changing `published_at`; first publish uses conditional `published_at IS NULL` update    |
| **Checks**        | `pnpm --filter @gloaming/backend test -- tests/functional/domains/works/works-epub.spec.ts` (publish/unpublish guards + idempotency) |

**Status:** **done** (PR-03, worktree `codex/user-first-pr03-publication-ssot`; implementation and verification complete, documentation closeout included, 2026-09-28).

**PR-03 accepted evidence (Publication SSOT — behavior unchanged from A2 except idempotent publish):**

| Acceptance item          | Result                                                                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publishWork` idempotent | Repeat `POST …/publish` returns **200** without changing the first `publishedAt` / `published_at` (conditional update when `published_at IS NULL`; early return when already published) |
| Publish guards           | Publish requires **`processingStatus = ready`** and reuses existing publish gate validation (no new publication fields/helpers/services in scope)                                       |
| `unpublishWork`          | Sets `published_at` to **null**; **`processingStatus` unchanged**; unpublish **409** guards unchanged                                                                                   |
| Contract / schema        | **No** migration; **no** API response-shape change in this PR                                                                                                                           |
| Pipeline semantics       | Metadata workflow still terminal at **`ready`**; **TTS remains a workflow step** (not conflated with publication)                                                                       |

**Non-goals (PR-03):** schema migration, frontend implementation, Lazy TTS, and **PR-04+** epic work.

**Verification (2026-09-28 PR-03 closeout on `codex/user-first-pr03-publication-ssot`; `gloaming_test`):**

| Check                                                        | Result                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Invocation method                                            | Existing locally installed Vitest, TypeScript (`tsc`), and ESLint binaries invoked **directly** — this environment's pnpm launcher rejected its registry signature (checks were **not** executed via `pnpm`; registry signature verification was **not** bypassed) |
| Backend functional regression group (**8 files / 35 tests**) | **pass** — includes PR-01 schema constraints, `works-epub` publish/unpublish (idempotency), Catalog taxonomy, Work Access Policy, Reader, audio, shelf, recommendations                                                                                            |
| `@gloaming/shared` `src/works/works.spec.ts` (Vitest)        | **14/14** pass                                                                                                                                                                                                                                                     |
| `tsc --noEmit` (backend, web)                                | pass                                                                                                                                                                                                                                                               |
| ESLint (backend, shared, web)                                | pass — **0** errors; **1** pre-existing `@next/next/no-img-element` **warning** in `apps/web/features/admin/works/works-preview-page.tsx`                                                                                                                          |
| `git diff --check`                                           | pass                                                                                                                                                                                                                                                               |
| Full monorepo typecheck / test / lint                        | **open** — not run as part of PR-03 closeout                                                                                                                                                                                                                       |

**Legacy audit (publication / processing separation):**

| Finding                                                          | Result                                                                                        |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Runtime `processingStatus='published'` (repository source audit) | **0** code references in active runtime source                                                |
| Runtime `processingStatus='tts'` (repository source audit)       | **0** code references in active runtime source                                                |
| Legacy `published` / `tts` as `processingStatus`                 | **Shared negative tests** only — sole matches in active source search                         |
| Publication storage / dual paths                                 | **No** old publication-status fallback, dual read/write, or stored publication boolean        |
| Publication consumers                                            | Use **`publishedAt`** / SQL **`published_at`** (and catalog/discover filters aligned with A2) |
| `isWorkPublished`                                                | Pure computed helper (not a persisted publication flag)                                       |

---

### Access — read authorization boundaries (Access phase)

**Not in PR-01.** Epic requires explicit gates before Catalog/Ingest routing and Library APIs ship.

#### AC1 — User-owned Work read boundary

|                   |                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Scope**         | Reader/discover/detail paths: `owner_user_id = user` OR policy-defined share; private user uploads not readable by other users |
| **Prerequisites** | B1 (schema), A2                                                                                                                |
| **Done when**     | Functional tests prove cross-user read denied for private owned works; owner read allowed                                      |
| **Checks**        | New/extended functional specs under `tests/functional/domains/works/` (or access-specific folder)                              |

**Status:** **done** (PR-02, `apps/backend/src/domains/works/access/` — `WorkReadActor`, `workReadAccessSql`, `requireReadableWorkWithParts` / `requireReadablePart`; 2026-09-28).

#### AC2 — Catalog Work read boundary

|                   |                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| **Scope**         | Non-owner reads respect `published_at`, `visibility`, and catalog vs user-owned rules          |
| **Prerequisites** | AC1, A2                                                                                        |
| **Done when**     | Unpublished or non-visible catalog works not exposed on user surfaces; admin bypass documented |
| **Checks**        | `tests/functional/domains/works/works-epub.spec.ts` + discover/catalog specs                   |

**Status:** **done** (PR-02; catalog list/detail and reader part load use `publicCatalogWorkSql` / `workReadAccessSql` with route actor; 2026-09-28).

**PR-02 evidence (worktree `codex/user-first-pr02-work-access-policy`, baseline PR-01 `a7804424`):**

| Area                                   | Change                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Policy owner                           | `apps/backend/src/domains/works/access/` (`actor`, `predicate`, `policy`, `index`) — `publicCatalogWorkSql`, `workReadAccessSql`, `requireReadablePart` / `requireReadableWorkWithParts`                                                                                                                                                                  |
| Migrated consumers                     | Reader (`reader/service` authorized part join), assets gateway (orphan admin read), translate, assist (+ dictionary lookup), conversations (DB-filtered list totals), reading history query, shelf (`getShelf` joins `publicCatalogWorkSql`), `GET /api/recommendations` (`publicCatalogWorkSql`); `GET /api/catalog/works/:id` → `getCatalogWork(actor)` |
| Removed                                | `getPublishedWork` / `getPublishedWorkTitle`; unguarded `getPartById`; `assets/content/published.ts` (`requirePublished*`, `getPublishedPartAudioTrack`, `resolveAssetViewer`)                                                                                                                                                                            |
| Privileged paths (unchanged direct DB) | Admin works pipeline, ingest/workers, `assets/content/read-model` admin audio                                                                                                                                                                                                                                                                             |
| Functional tests                       | `work-access-policy.spec.ts` matrix (owner/admin vs other/anonymous on reader, assets, audio, catalog detail, reading state, translate/assist IDOR + owner mocks); `recommendations-catalog-policy.spec.ts`; `shelf.spec.ts`; plus reader/audio/assets/conversations/dictionary/translate/assist/history specs                                            |
| Checks                                 | `pnpm --filter @gloaming/backend exec tsc --noEmit`; `pnpm --filter @gloaming/backend lint`; targeted vitest on `gloaming_test` (see follow-up verification in branch)                                                                                                                                                                                    |

---

### B. Database (Schema phase)

#### B1 — PR-01 migration and schema

|                   |                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Scope**         | `0036_*.sql`, `packages/db/src/schema.ts`, journal                                                                                       |
| **Prerequisites** | None                                                                                                                                     |
| **Done when**     | Test DB migrates; constraints match ADR                                                                                                  |
| **Checks**        | `pnpm db:migrate:test`; `pnpm --filter @gloaming/backend test -- tests/functional/domains/db/user-first-pr01-schema-constraints.spec.ts` |

**Status:** **done** (**4/4** constraints + migration applied on `gloaming_test`, 2026-09-28).

#### B2 — Seed/dev scripts use `processing_status`

|                   |                                               |
| ----------------- | --------------------------------------------- |
| **Scope**         | `apps/backend/scripts/seed-dev-works.ts`      |
| **Prerequisites** | B1                                            |
| **Done when**     | Seeds insert valid `processing_status` values |
| **Checks**        | `pnpm seed:dev` (manual, dev DB only)         |

**Status:** **done** on branch (file modified in PR-01 diff).

---

### C. Catalog / ingest (admin pipeline) — Catalog/Ingest phase

#### C1 — Workflow commands use `processingStatus`

|                   |                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------- |
| **Scope**         | `run-content-parse-workflow`, `retry-workflow`, `advance-tts-workflow`, metadata enrich |
| **Prerequisites** | B1, A1                                                                                  |
| **Done when**     | State transitions use six processing values; TTS step does not add `tts` status         |
| **Checks**        | `pnpm --filter @gloaming/backend test -- tests/functional/domains/ingest/`              |

**Status:** **done** on branch (13 focused backend files / **97 tests** passed on `gloaming_test`, 2026-09-28).

#### C2 — Admin list/filter API alignment for TTS “busy”

|                   |                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Scope**         | `admin-work-read` list query + shared filter contract; optional `workflowStep` filter                                           |
| **Prerequisites** | C1, A1                                                                                                                          |
| **Done when**     | “Busy” tab needs no client-side drop of valid `ready` rows OR contract documents server filter including TTS meta               |
| **Checks**        | `pnpm --filter @gloaming/web test -- features/admin/works/works-model.spec.ts`; extend backend list test if server filter added |

**Status:** **open** (known server/client “busy” vs TTS taxonomy gap; Catalog/Ingest phase — **not** claimed done in PR-01).

#### C3 — Rename admin catalog routes (API)

|                   |                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| **Scope**         | Hono routes `/api/admin/works` → `/api/admin/catalog/works`; remove old paths                       |
| **Prerequisites** | C1 stable, AC2 recommended                                                                          |
| **Done when**     | No `/api/admin/works` registrars; tests and web clients updated                                     |
| **Checks**        | `rg '/api/admin/works' apps/backend apps/web packages` → no matches (except changelog/docs history) |

**Status:** **open**.

#### C4 — Rename admin catalog routes (web)

|                   |                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------- |
| **Scope**         | `apps/web/app/admin/works` → `app/admin/catalog/works`; feature folder rename optional |
| **Prerequisites** | C3 (or temporary dual mount with deprecation — prefer single cut per epic)             |
| **Done when**     | `/admin/works` returns 404 or redirect; nav links target catalog path                  |
| **Checks**        | `rg '/admin/works' apps/web`; `pnpm typecheck:web`                                     |

**Status:** **open**.

---

### D. Library — Library phase (after Catalog/Ingest PR-04)

#### D1 — Library membership service

|                   |                                                                                 |
| ----------------- | ------------------------------------------------------------------------------- |
| **Scope**         | CRUD for `user_library_item`; idempotent add/remove                             |
| **Prerequisites** | B1, AC1, AC2; after Catalog/Ingest PR-04 (C2–C4) for stable admin/user surfaces |
| **Done when**     | API can add/remove catalog work; unique violation surfaced as 409               |
| **Checks**        | New functional spec under `tests/functional/domains/library/`                   |

**Status:** **open**.

#### D2 — My Library read model

|                   |                                                                     |
| ----------------- | ------------------------------------------------------------------- |
| **Scope**         | Query owned works ∪ library items; shared DTO if new public surface |
| **Prerequisites** | D1, A2                                                              |
| **Done when**     | Documented union matches ADR; pagination if needed                  |
| **Checks**        | Functional + shared schema tests                                    |

**Status:** **open**.

#### D3 — Shelf uses membership + `reading_state`

|                   |                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------- |
| **Scope**         | `apps/backend/src/domains/shelf/service.ts`, shared `ShelfData` if shape changes            |
| **Prerequisites** | D2                                                                                          |
| **Done when**     | Shelf listing does not treat `reading_state` row as implicit library join for catalog saves |
| **Checks**        | `pnpm --filter @gloaming/backend test` (shelf/history specs)                                |

**Status:** **open**.

#### D4 — Reader/book-detail “Save to library” UX

|                   |                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------ |
| **Scope**         | Web feature + API wiring                                                             |
| **Prerequisites** | D1                                                                                   |
| **Done when**     | User can save catalog work; remove from library retains reading state                |
| **Checks**        | `pnpm --filter @gloaming/web test -- features/book-detail/book-detail-model.spec.ts` |

**Status:** **open**.

---

### E. Provider scope — runtime behavior (Provider phase)

#### E1 — Schema scope columns (PR-01 / Schema phase)

|                   |                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Scope**         | `owner_user_id` + partial unique indexes                                                                         |
| **Prerequisites** | B1                                                                                                               |
| **Done when**     | Constraint tests pass                                                                                            |
| **Checks**        | `pnpm --filter @gloaming/backend test -- tests/functional/domains/db/user-first-pr01-schema-constraints.spec.ts` |

**Status:** **done** (schema + **4/4** constraint tests; not provider query behavior).

#### E2 — Backend read/write respects scope

|                   |                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| **Scope**         | `apps/backend/src/domains/llm/**`, TTS config services, admin + user-facing settings **API behavior** |
| **Prerequisites** | E1, Library phase optional for user surfaces                                                          |
| **Done when**     | Instance admins manage `owner_user_id IS NULL`; users manage own rows only                            |
| **Checks**        | `pnpm --filter @gloaming/backend test -- tests/functional/domains/llm/`                               |

**Status:** **open** (PR-01 landed columns only; scope filters and runtime behavior **not** verified complete).

---

### H. Settings UI (Settings phase)

#### E3 — Web settings UI scope

|                   |                                             |
| ----------------- | ------------------------------------------- |
| **Scope**         | Admin config vs user settings pages         |
| **Prerequisites** | E2 (Provider runtime)                       |
| **Done when**     | UI loads correct scope; no duplicate tables |
| **Checks**        | `pnpm typecheck:web`; manual admin smoke    |

**Status:** **open** (separate PR from Provider backend — do not merge into one “providers/settings” PR).

---

### F. Web admin processing UI (PR-01 partial — Schema/Publication UI)

#### F1 — Admin work UI uses `processingStatus` / `publishedAt`

|                   |                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Scope**         | `works-list-page`, `works-edit-page`, `metadata-review-panel`, `works-format`                                         |
| **Prerequisites** | A1, A2                                                                                                                |
| **Done when**     | No UI references legacy `status` field on works                                                                       |
| **Checks**        | `pnpm --filter @gloaming/web test -- features/admin/works/works-model.spec.ts` (plus other admin work specs as added) |

**Status:** **done** on branch (`works-model.spec.ts` part of **33/33** web targeted run, 2026-09-28).

---

### G. Closeout

#### G1 — Legacy Remaining inventory

|                   |                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------- |
| **Scope**         | Extend `docs/product/feature-audit.md` or scripted `rg` checklist for forbidden symbols/paths |
| **Prerequisites** | C3, C4, D3, E2, E3, AC1, AC2                                                                  |
| **Done when**     | Checklist executed; all items fixed or ADR-excepted                                           |
| **Checks**        | Documented command list exits 0                                                               |

**Status:** **open**.

#### G2 — SSOT/docs sync

|                   |                                                              |
| ----------------- | ------------------------------------------------------------ |
| **Scope**         | ADR-001, engineering-vocabulary, this plan — mark tasks done |
| **Prerequisites** | G1                                                           |
| **Done when**     | “Current vs target” matrix has no false **done** rows        |
| **Checks**        | Peer review                                                  |

**Status:** **in progress** (this document + 2026-09-28 doc edits).

#### G3 — Full regression

|                   |                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Scope**         | Monorepo test + typecheck                                                                                                     |
| **Prerequisites** | All epic tasks **done**                                                                                                       |
| **Done when**     | `pnpm typecheck` and `pnpm test` green in CI                                                                                  |
| **Checks**        | Root `pnpm typecheck`, `pnpm lint`, `pnpm test` — **open** for this branch review; CI on epic branch after all tasks **done** |

**Status:** **open** (targeted PR-01 checks passed; full monorepo suite not run).

---

## Suggested epic merge order (PR-sized)

Follow locked phase order. **Do not** place Library (PR-05) before Catalog/Ingest routing (PR-04). **Do not** combine Provider runtime (E2) and Settings UI (E3) in one PR.

| PR        | Phase                                                                      | Tasks                                                             | Status                                                                                                                   |
| --------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **PR-01** | Schema foundation (+ the linked processing/publication contract migration) | B1, B2, A1, A2, C1, E1, F1                                        | **done within PR-01 scope** on `codex/user-first-pr01-schema-foundation` — evidence above; later epic phases remain open |
| **PR-02** | Access                                                                     | AC1, AC2                                                          | **done** in worktree (policy + regression tests above; acceptance by calling agent)                                      |
| **PR-03** | Publication                                                                | A3 (idempotent `publishWork` / `published_at` SSOT)               | **done** — evidence under **A3** (2026-09-28 closeout)                                                                   |
| **PR-04** | Catalog/Ingest                                                             | C2 (TTS “busy” / list taxonomy), C3 (API routes), C4 (web routes) | **open** (C2 known gap)                                                                                                  |
| **PR-05** | Library                                                                    | D1, D2, D3, D4                                                    | **open**                                                                                                                 |
| **PR-06** | Provider                                                                   | E2 (backend scope behavior only)                                  | **open**                                                                                                                 |
| **PR-07** | Settings                                                                   | E3 (web settings UI)                                              | **open**                                                                                                                 |
| **PR-08** | closeout                                                                   | G1, G2, G3                                                        | **open**                                                                                                                 |

**Explicitly not done after PR-03:** **PR-04** Catalog/Ingest (C2–C4), **PR-05** Library (D1–D4), **PR-06** Provider (E2), **PR-07** Settings (E3), **PR-08** closeout (G1–G3). Full monorepo `pnpm test` / root `pnpm lint` / root `pnpm typecheck` remain **open**. These are follow-on epic phases, not unfinished PR-03 acceptance items.

---

## Revision log

| Date       | Change                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| 2026-09-28 | Initial plan; PR-01 done/open ledger                                                                               |
| 2026-09-28 | Locked phase order; Access tasks; PR order fix; verification evidence; filter-relative test paths                  |
| 2026-09-28 | PR-03 Publication (A3 idempotent publish) **done**; roadmap renumbered PR-04 Catalog/Ingest through PR-08 closeout |
| 2026-09-28 | PR-03 documentation verification closeout — A3 evidence, checks, legacy audit; “not done after PR-03” ledger       |
