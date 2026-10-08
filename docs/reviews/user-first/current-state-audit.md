# Gloaming Current State Audit

Audit date: 2026-10-08
Branch: `dev-02`
Starting HEAD: `9f40a1bb3547661e69e79e0683346c03d20f02c6`
Scope: read-only review of source, schema, routes, tests, migrations, tracked review records, and available runtime evidence. No application code, database, or runtime was changed or started.

Status labels describe repository evidence at the starting HEAD. Runtime availability is called out separately; code and tests do not prove a deployed or browser-usable flow.

## 1. Executive Summary

1. **DONE** — The code still expresses Gloaming as a personal English reading environment: ReadingWork/ReadingPart, Library, Reader, contextual AI, TTS, progress, and history are the active product surfaces. Admin Catalog intake and global Catalog taxonomy are absent from current runtime routes/schema.
2. **DONE** — User routes include `/discover`, `/discover/[workId]`, `/library`, `/library/tags`, `/read/[workId]`, `/reading-history`, `/settings`, `/account`, and `/more`. `/my-shelf` has no page or compatibility redirect.
3. **PARTIAL** — `/library` has migrated to `user_library_item` + Work ownership and User Tags, but returns at most 48 items before the UI applies source/tag filters.
4. **DONE** — Personal EPUB upload is present in the Library UI and calls authenticated `POST /api/works`; it creates a private Work owned by the session user and appears in Library while processing.
5. **PARTIAL** — Personal Works can edit title/author/description and delete when `ready` or `failed`. There is no user retry, cover/language editing, standalone Personal detail page, or safe delete while uploaded/processing.
6. **PARTIAL** — `user_tag` and `user_work_tag` are user-scoped; CRUD and assignment work for owned Works and saved published Catalog Works, and membership removal removes associations. Unpublished Source-materialized memberships are not currently tag-manageable.
7. **DONE** — Work read authorization is centralized: owner, public published Catalog, or own membership to an unpublished Source-linked Work. Admin role alone grants no content access. Reader, assets, and history use this policy in source.
8. **PARTIAL** — User LLM BYOK has Settings UI/API and a User → Instance resolver used by contextual AI paths. User TTS settings exist, but the Reader reads shared pre-generated ContentAsset audio and does not pass user identity to synthesis; user TTS BYOK is not connected to Reader playback.
9. **DONE** — Reading History is `/reading-history` backed by `/api/reading-history`, `reading_state`, `reading_day`, and conversation-derived counts; there is no `reading_history` table.
10. **DONE** — Current SourceRecord schema, public backend list/detail APIs, official Gutenberg metadata sync, single-EPUB materialization, and Save Intent API/worker code all exist. The RDF sync stores metadata/candidates and does not bulk-download EPUBs.
11. **PARTIAL** — Actual `/discover` still requests `GET /api/catalog/works`; `/discover/[workId]` still treats its ID as a ReadingWork ID. SourceRecord UI, Save CTA, batch intent status, polling, and Library invalidation are not wired.
12. **PARTIAL** — Materialization is idempotent/concurrency guarded in source and Save Intent has an explicit late-intent reread/fan-out path. These are automated-code claims; no current runtime acceptance was performed.
13. **DONE** — Migrations 0037–0044 are in the repository/journal. Repo schema is at 0044. Current `gloaming_test` and `gloaming_backend` migration heads could not be read in this audit; the last tracked runtime note recorded 0041 applied to both on 2026-10-04.
14. **SUPERSEDED** — Old `/my-shelf`, global Catalog taxonomy, Admin Works CMS, Admin taxonomy, and Admin per-object browser descriptions in older review documents do not describe current runtime.
15. **PARTIAL** — The product has the core reading domains, but the shortest Gutenberg journey stops at Discover: SourceRecord → Save Intent → Library → Reader is not yet connected in the user UI. Architecture is currently ahead of user-visible discovery integration.

## 2. User Journey Status

| Capability          | Status  | Evidence                                                                                                                                                                | Missing                                                                                                                      |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Discover            | PARTIAL | `/discover` → `features/discover/discover-api.ts` → `GET /api/catalog/works`; separate public `GET /api/discover/records` exists in `domains/discovery/routes/index.ts` | Replace/extend Catalog-backed UI to list SourceRecords and add SourceRecord details                                          |
| Save                | PARTIAL | Authenticated `POST /api/library/source-records/:sourceRecordId`; `source_record_save_intent` stores `pending/failed/completed`                                         | Discover CTA, status projection, pending/completed/failed UI, polling, and retry UI                                          |
| Library             | PARTIAL | `/library`; `/api/library`; `libraryItemKind` distinguishes `personal`/`saved_catalog`; filter is client-side; `LIBRARY_ITEMS_LIMIT = 48`                               | Server filtering/pagination so filters cover items beyond the 48-row cap                                                     |
| Personal Upload     | DONE    | `/library` upload dialog → multipart `POST /api/works`; `origin_kind='user_epub'`, private, session-owned                                                               | Browser/runtime acceptance at current HEAD                                                                                   |
| Personal Management | PARTIAL | `PATCH/DELETE /api/works/:workId`; Library sheet/card exposes title/author/description edit and ready/failed delete                                                     | User retry, cover/language edit, independent detail page, and processing delete lifecycle                                    |
| Reader              | DONE    | `/read/[workId]`; `GET /api/reader/works/:workId/parts`; common access policy permits owner/published public/own Source membership                                      | Current authenticated browser verification; SourceRecord flow not yet linked from Discover                                   |
| AI                  | PARTIAL | User provider/model/purpose APIs and Settings UI; Assist/Translate enter shared runtime/resolver                                                                        | Some purpose mappings lack a user-actor consumer; current browser/runtime verification                                       |
| TTS                 | PARTIAL | Reader requests existing `/api/reader/parts/:partId/audio`; user Azure TTS settings API/UI exists                                                                       | User TTS config is not consumed by Reader playback; newly materialized Work audio availability needs end-to-end verification |
| Progress            | DONE    | `reading_state` and Reader state endpoints; Library current-reading projection is separate from membership                                                              | Current runtime verification                                                                                                 |
| History             | DONE    | `/reading-history` → authenticated `/api/reading-history`; history Work rows use shared Work Access Policy                                                              | Current runtime verification and historical migration-intent decision                                                        |
| Settings            | PARTIAL | `/settings`; LLM Provider/Model/purpose and Azure TTS configuration forms, authenticated APIs                                                                           | TTS Reader use; clarify mappings with no current consumer; visual/runtime acceptance                                         |
| Account             | DONE    | `/account`; profile plus change-email/change-password forms                                                                                                             | Current runtime verification                                                                                                 |

## 3. Backend / Domain Status

| Domain           | Status  | Evidence and boundary                                                                                                                                                                                                                                                                                                                                         |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User Tag         | PARTIAL | `user_tag`, `user_work_tag`; `/api/library/tags` GET/POST/PATCH/DELETE and per-Work PUT/DELETE. User-owned Works and saved published Catalog Works are manageable. The current membership check requires `published_at IS NOT NULL`, so an unpublished Source-materialized Work with an explicit member cannot yet receive a User Tag.                        |
| Work Access      | DONE    | `workReadAccessSql`: owner OR published ownerless Catalog OR own Library membership AND unpublished ownerless Source-linked Work. Admin role never grants access. Reader, Asset Gateway, History use this policy.                                                                                                                                             |
| DiscoverySource  | DONE    | Schema and `GET/PATCH/POST .../sync` Admin routes for Project Gutenberg. Status includes enabled, sync state/timestamps, last success, record count, and sanitized error summary.                                                                                                                                                                             |
| SourceRecord     | DONE    | Separate source-owned metadata model with unique `(source_id, external_id)`, availability, content candidates, rights, and nullable unique Work link. Public list/detail APIs do not require auth.                                                                                                                                                            |
| Materialization  | PARTIAL | Selects one official Gutenberg EPUB candidate, downloads only on demand, reuses ingest/parser, creates ownerless `visibility='catalog'` Work with `published_at=null`, links it transactionally, and serializes concurrent insertions with `SELECT ... FOR UPDATE`. Parse retry reuses linked Work. Runtime and production image execution remain unverified. |
| SaveIntent       | PARTIAL | Unique `(user_id, source_record_id)`; statuses pending/failed/completed; authenticated save API, idempotent membership insert, failed retry, shared Work fan-out, and post-upsert link reread for the late-intent race. UI/status projection absent.                                                                                                          |
| Catalog legacy   | PARTIAL | Public `/api/catalog/works` and details remain for published ReadingWorks and still back Discover. Admin create/edit/publish/unpublish Catalog Work CMS and old global taxonomy tables/routes are absent.                                                                                                                                                     |
| Admin operations | PARTIAL | Instance AI/TTS/dictionary config, AI/TTS invocation logs, asset summary/cleanup, and Gutenberg source operations exist. No Admin user-management UI/API, generic Jobs/Worker console, system log center, or real priced usage/cost reporting.                                                                                                                |

### Discovery Source → Work / Save Intent detail

- **Materialization — DONE in source:** EPUB selection accepts official `https://www.gutenberg.org` EPUB paths, rejects HTML/text and deterministically ranks standard EPUB/EPUB3 and image variants (`materialization/epub-candidate.ts`). A single selected file is downloaded when materialization is requested; metadata sync itself saves candidate URLs only.
- **Gutenberg sync — DONE in source:** uses the configured official Project Gutenberg RDF snapshot URL (not page scraping or Gutendex), conditionally downloads via `If-Modified-Since`, streams through system `bzip2 -dc` → tar members → one-RDF-at-a-time XML parse → bounded batch upsert, then marks absent records unavailable only after a successful full snapshot. It does not download EPUBs during sync. The production Dockerfile installs `bzip2`; Docker build/run remains unverified.
- **Identity and concurrency — DONE in source:** `source_record.work_id` is nullable/unique and FK `ON DELETE SET NULL`; the Work insert and SourceRecord link share a transaction with row lock. Work is ownerless, catalog-visible, and unpublished. Parse failure retry re-enqueues the existing linked Work rather than creating another.
- **Save Intent — DONE in source:** One intent per user and SourceRecord; pending requests share one source-level materialization job. Once the linked Work is parse-complete, each pending user receives idempotent `user_library_item` membership. Save rereads the SourceRecord after intent upsert, covering a link committed during fan-out. Pending/failed intents do not independently appear in Library.
- **API/UI boundary — PARTIAL:** Save API returns pending or ready for the request; stored intent status is pending/failed/completed. There is no batch status projection endpoint or Discover query/mutation for SourceRecord intent status. No UI status display, polling, retry, or completed-state Library cache invalidation exists.
- **Discover identity — PARTIAL:** `/discover` list calls `/api/catalog/works`; card IDs are ReadingWork IDs. `/discover/[workId]` loads `GET /api/catalog/works/:id`. The SourceRecord endpoints use distinct IDs, but no SourceRecord list/detail components call them. Anonymous users can call the public SourceRecord API in code; the current anonymous Discover UI still shows the Catalog model.
- **DS-03C — PARTIAL:** backend schema/materialization/save workflow is present through HEAD `9f40a1bb`; the user-facing SourceRecord Discover integration has not started in the frontend. It is not marked blocked by source evidence; browser acceptance is still required.

## 4. Frontend Status

### Backend ready / UI missing

- SourceRecord search/list: backend `GET /api/discover/records` exists; Discover does not call it.
- SourceRecord detail: backend `GET /api/discover/records/:sourceRecordId` exists; `/discover/[workId]` is still Catalog ReadingWork detail.
- Save Intent: backend `POST /api/library/source-records/:sourceRecordId` exists; no client function, Save button, or status query calls it.
- Intent batch status/projection: no route or frontend query found. The UI cannot show idle/pending/completed/failed, poll, or retry.
- Admin Gutenberg source controls are connected in `/admin/discovery-sources` to enable/disable, manual sync, status/last success/error/count.

### Existing user routes and states

`/library` replaces `/my-shelf` with no compatibility route. `/reading-history` is the actual history page. `/settings` is real and includes User LLM/TTS settings; `/account` includes profile and password/email changes. Personal Work uses Library management and Reader routes; there is no separate Personal detail route. The route list and components are in `apps/web/app/(app)`, `apps/web/app/(reader)`, and `apps/web/app/admin`.

No current authenticated browser session, Light/Dark/Mobile visual pass, or current-HEAD user-flow screenshot was available. Treat user-visible runtime acceptance as NEEDS_RUNTIME_VERIFICATION.

## 5. Database Migration State

| Migration | Purpose                                                                              | Repo | Current DB application                                                                                           | Snapshot/journal evidence                          |
| --------- | ------------------------------------------------------------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 0037      | Scrub AI/TTS invocation previews/errors; drop TTS `text_preview`                     | DONE | NEEDS_RUNTIME_VERIFICATION; last historical DB check is at least 0041                                            | SQL and journal entry present; no current DB query |
| 0038      | Remove legacy Admin Work provenance; constrain `origin_kind` to nullable `user_epub` | DONE | NEEDS_RUNTIME_VERIFICATION                                                                                       | SQL and journal entry present                      |
| 0039      | Remove timestamps from legacy taxonomy tables                                        | DONE | NEEDS_RUNTIME_VERIFICATION                                                                                       | SQL and journal entry present                      |
| 0040      | Create user-owned `user_tag` and `user_work_tag`                                     | DONE | NEEDS_RUNTIME_VERIFICATION                                                                                       | SQL, journal, and 0040 snapshot present            |
| 0041      | Drop legacy global Catalog taxonomy tables                                           | DONE | NEEDS_RUNTIME_VERIFICATION; historical note says applied to `gloaming_test` and `gloaming_backend` on 2026-10-04 | SQL and journal entry present                      |
| 0042      | Create `discovery_source` and `source_record` metadata tables                        | DONE | NEEDS_RUNTIME_VERIFICATION                                                                                       | SQL, journal, and 0042 snapshot present            |
| 0043      | Add SourceRecord ↔ Work link and materialization status                              | DONE | NEEDS_RUNTIME_VERIFICATION                                                                                       | SQL, journal, and 0043 snapshot present            |
| 0044      | Add per-user SourceRecord Save Intent table/constraints                              | DONE | NEEDS_RUNTIME_VERIFICATION                                                                                       | SQL, journal, and 0044 snapshot present            |

**Repo head:** 0044. **Last tracked `gloaming_test`/`gloaming_backend` head:** 0041 (2026-10-04); **current heads:** NEEDS_RUNTIME_VERIFICATION. The audit process had no `TEST_DATABASE_URL`/`DATABASE_URL` in its environment and no local Docker services to query. Do not treat that as proof the databases remain at 0041.

If a database is still at 0041, current SourceRecord list/detail/sync will lack `discovery_source`/`source_record`; materialization also requires 0043 columns; Save Intent requires 0044 table. Latest backend requests/jobs using those features will fail at database access until migrations are applied. Before SourceRecord runtime UI acceptance, verify and, if needed, apply **0042 → 0043 → 0044** separately to the isolated test and backend databases. No migration was run in this audit.

Journal entries for 0037–0044 and all SQL files are present. Snapshots exist for 0040, 0042, 0043, and 0044; 0037–0039 and 0041 do not have same-numbered snapshots. No snapshot/journal validation was run, so treat any generator-chain concern as NEEDS_RUNTIME_VERIFICATION, not a confirmed defect.

## 6. Runtime Verification State

| Area                                        | Status                     | Current evidence limit                                                                                                                                  |
| ------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SourceRecord list/detail and Gutenberg sync | NEEDS_RUNTIME_VERIFICATION | Source/tests exist; no current DB, API, or browser run                                                                                                  |
| Save Intent/materialization/fan-out         | NEEDS_RUNTIME_VERIFICATION | Functional/unit/schema tests exist in repo; no current DB-backed run                                                                                    |
| Personal Upload/Management                  | NEEDS_RUNTIME_VERIFICATION | Routes/UI/tests exist; no current authenticated browser run                                                                                             |
| Reader/History/Access matrix                | NEEDS_RUNTIME_VERIFICATION | Shared policy and functional tests exist; no current user session run                                                                                   |
| Settings LLM/TTS                            | NEEDS_RUNTIME_VERIFICATION | API/UI/resolver source exists; no current user-provider runtime check                                                                                   |
| Backend full suite/build                    | NEEDS_RUNTIME_VERIFICATION | No run artifact tied to HEAD 9f40a1bb; audit did not run it                                                                                             |
| Web full suite/build                        | NEEDS_RUNTIME_VERIFICATION | No run artifact tied to HEAD 9f40a1bb; audit did not run it                                                                                             |
| Backend Docker build/sync                   | NEEDS_RUNTIME_VERIFICATION | `apps/backend/Dockerfile` installs system `bzip2`, but the production image was not built or run here                                                   |
| Light/Dark/Mobile UI                        | NEEDS_RUNTIME_VERIFICATION | No current visual acceptance record for authenticated Library/Discover/Settings                                                                         |
| Stale EPUB parse timeout                    | NEEDS_RUNTIME_VERIFICATION | HEAD includes `0d4b35f7 fix(ingest): align epub parser fixture contract`; this source change alone does not prove the prior timeout is fixed            |
| GitNexus                                    | PARTIAL                    | Index is stale at `9d9f345` (2026-09-29) and reports `incremental-in-progress`; all impact conclusions in this audit are manual source/call-site checks |

Do not quote a current full-suite pass count or production-build success without a post-HEAD run record. Existing tests are evidence of intended contracts, not current runtime acceptance.

## 7. Legacy / Debt

| Class                 | Findings                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime               | Discover still depends on `/api/catalog/works` and ReadingWork detail; old public Catalog APIs remain intentionally available. `ContentAssetMeta.lastError` and `reading_work.originMeta.lastError` can be written from raw `error.message` in audio/workflow failure paths; invocation logs sanitize previews/errors, but persisted operational error text needs a sensitivity review. |
| Historical            | Migrations 0037–0041, old taxonomy table names, old Shelf/Article wording in tests/docs, and Redis scanner snapshot compatibility are migration/history evidence, not proof of active runtime. PR-10/PR-11 Lazy TTS branches remain separate and are not ancestors of `dev-02`; Lazy TTS is not in current runtime.                                                                     |
| Naming                | Internal `domains/works`, `features/admin`, `catalog` API/DTO names and `/discover/[workId]` retain ReadingWork/Catalog terminology. `/my-shelf` has no runtime route. `discovery_source` is new Source infrastructure, separate from deleted legacy `source` taxonomy.                                                                                                                 |
| Deferred Architecture | Cross-Source merge, Standard Ebooks, recommendation/ranking, taxonomy, generic Admin Jobs/Worker console, user-specific Lazy TTS/cache/cost semantics, and broad architecture subtraction are outside the shortest first-user journey.                                                                                                                                                  |

### Stale or historical documents

- `frontend-design-baseline.md` describes `/my-shelf`, old Catalog taxonomy filters, and Settings as missing; those statements predate `/library`, User Tags, and `/settings`.
- `library-management-capability.md` says Personal update/delete APIs and source discriminator do not exist; current `PATCH/DELETE /api/works/:workId` and `libraryItemKind` make those claims stale. Its 48-item cap warning remains current.
- `review-gate-02-summary.md` and `integration-gate-01-summary.md` are valuable historical gates, but their Discover/API and Personal management snapshots predate commits in this branch. Do not use them as current source truth.
- `discovery-source-architecture.md` is the accepted design boundary, not evidence of user-facing completion. It describes the separation and non-goals; current code has added backend APIs/materialization/save intent while the frontend remains Catalog-backed.

## 8. Product Drift Assessment

**Journey:** Discover **PARTIAL** → Save **PARTIAL** → Library **PARTIAL** → Reader **DONE** → AI/TTS **PARTIAL** → Progress/History **DONE**.

**Has the project drifted from the product line?** The domain direction has not drifted: it remains authentic reading with optional contextual AI and separated ownership/progress/history. The delivered user journey is behind the architecture: Gutenberg metadata and Save Intent exist in Backend, while the Discover page cannot show or save those records.

**Where did recent effort go?** More recently into foundations than user-visible completion: three consecutive discovery commits added metadata sync, materialization, and Save Intent, plus migrations 0042–0044 and backend tests; the frontend Discover integration is still absent.

**Which foundation work was necessary?** Separate SourceRecord identity from ReadingWork; persist source rights/candidates; materialize on demand; create one shared ownerless Work; gate unpublished Work access by explicit per-user Library membership; and use one idempotent Save Intent per user/source record. These close real ownership, privacy, and cost boundaries for a public catalog.

**Where does architecture exceed UX?** SourceRecord backend APIs, atomic materialization, race recovery, and Admin sync operations are ahead of Discover list/detail/save UX, status projection, and authenticated browser acceptance. User TTS configuration also exceeds its Reader runtime integration.

**What remains for a first complete User-first V1?** A user must browse a SourceRecord, open that same SourceRecord’s detail, save it, see progress/failure/retry, then find the resulting membership in Library and open it in Reader. Current UI breaks before the first step. Verify TTS availability for these newly materialized Works and confirm the desired default-vs-user TTS behavior. Then finish authenticated runtime/visual acceptance.

## 9. Remaining V1 Work

### P0

- **Database readiness:** verify migration heads for `gloaming_test` and `gloaming_backend`; apply 0042–0044 only where absent before runtime acceptance. The current backend expects those tables/columns.
- **Discover SourceRecord path:** connect `/discover` and a SourceRecord detail route to SourceRecord APIs; preserve SourceRecord identity until save/materialization resolves to a Work ID.
- **Save Intent UX:** connect Save CTA to the authenticated API and provide per-user status projection, pending/completed/failed presentation, retry, polling, and Library cache refresh.
- **End-to-end acceptance:** verify anonymous browsing, authenticated save → Library membership → Reader, another user denied unpublished Work/asset/history access, and production-shaped backend availability after migration.

### P1

- **TTS for newly materialized Works:** verify that a normal user can play audio and define whether Reader should consume User TTS settings or an Instance/default audio path. Current Reader playback uses existing shared audio assets.
- **Visual and responsive acceptance:** authenticated Light/Dark/Mobile review for Discover, Library, Reader, and Settings.
- **Personal failure recovery:** expose a safe retry path for failed Personal EPUB parsing and define processing delete fencing only if user demand requires it.

### P2

- Remove Library truncation by introducing server-side pagination/filtering; current 48-row response can make filtered groups incomplete.
- Consider cover/language edits and a standalone Personal detail view after the basic reading journey closes.
- Resolve historical 0036 migration semantics for Library membership and whether deleting a Work should retain per-Work progress/history/log records.

## 10. Recommended Next 5 Steps

1. **Confirm database heads and migration readiness.** Outcome: read-only verified migration head per database, then apply 0042–0044 where needed in a separately authorized migration task. This is the runtime prerequisite; it lets the new discovery APIs reach their tables.
2. **Finish Discover SourceRecord browsing.** Outcome: `/discover` lists SourceRecords and detail uses SourceRecord IDs/data. This is where users can find actual Gutenberg books.
3. **Finish Save Intent in the user flow.** Outcome: authenticated Save shows pending/completed/failed and retry, Library refreshes on completion. This connects a book choice to a user’s Library.
4. **Run authenticated end-to-end and visual acceptance.** Outcome: one real SourceRecord completes Save → Library → Reader on desktop/mobile and Light/Dark, with anonymous and second-user access checks. This proves the intended journey rather than only backend contracts.
5. **Close the Reader TTS path for imported Works.** Outcome: document and verify which audio provider/config a reader actually gets for a newly materialized Work. This ensures the promised reading assistance is available after saving.

## 11. Stop / Defer List

- Large Admin Jobs/Worker console and user-management system.
- Standard Ebooks or another second metadata source.
- Cross-Source merge, fuzzy deduplication, and global or advanced taxonomy.
- Advanced recommendation, ranking, or popularity systems.
- Broad architecture subtraction/refactoring while the first SourceRecord journey remains unwired.
- Lazy/per-user TTS cache redesign until its User-vs-Instance behavior, cache identity, and cost expectations have an explicit product/architecture decision.
- More backend discovery substrate work unless a concrete runtime defect blocks the one SourceRecord → Save → Library → Reader path.
