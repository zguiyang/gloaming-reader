# Engineering vocabulary

Gloaming uses **product language** in UX and **engineering language** in code/APIs. This doc maps the two and records the **Reading Content** domain (ADR-001, amended 2026-09-28 for User-first).

**Domain SSOT:** [`docs/adr/001-reading-content-domain-model.md`](../adr/001-reading-content-domain-model.md)
**User-first execution plan:** [`docs/plans/user-first-architecture-implementation.md`](../plans/user-first-architecture-implementation.md)

---

## Domain model (target — ADR-001 User-first)

| Product concept (UX)          | Engineering entity  | Table / module (target)                                               |
| ----------------------------- | ------------------- | --------------------------------------------------------------------- |
| 一本书 / 一份阅读内容         | **ReadingWork**     | `reading_work`                                                        |
| 章节 / 阅读单元               | **ReadingPart**     | `reading_part`                                                        |
| 保存到我的书库 / Library 成员 | **UserLibraryItem** | `user_library_item`                                                   |
| 阅读进度与位置                | **ReadingState**    | `reading_state`                                                       |
| 文件 / 音频等资源             | **ContentAsset**    | `content_asset`                                                       |
| AI 对话（本书上下文）         | **Conversation**    | `conversation` (`subject_type = reading_work`)                        |
| 我的书库 (My Library)         | **Library**         | Read model — owned works ∪ `user_library_item`                        |
| 继续阅读 / 书架展示           | **Shelf**           | Read model — Library ∩ published rules + `reading_state` for position |

UI copy may still say **书 / Book / 封面 / 章节** — intentional user metaphor, not legacy engineering names.

### ReadingWork status vocabulary (target)

| Concept              | Field / API         | Values / rule                                                                |
| -------------------- | ------------------- | ---------------------------------------------------------------------------- |
| Pipeline progress    | `processing_status` | `uploaded`, `processing`, `parsed`, `metadata`, `ready`, `failed` only       |
| Published to catalog | `published_at`      | non-null timestamp = Catalog eligible; Discover filters this field           |
| TTS in flight        | workflow metadata   | `origin_meta` workflow step `tts` while `processing_status` may stay `ready` |

Do **not** use `published` or `tts` as `processing_status` values.

### Provider / TTS settings scope (target)

| Scope    | `owner_user_id` | Tables                                          |
| -------- | --------------- | ----------------------------------------------- |
| Instance | `NULL`          | `llm_provider`, `llm_app_setting`, `tts_config` |
| User     | user id         | same tables — no `user_llm_*` duplicate tables  |

---

## Product surfaces (user-facing)

| Surface             | Route              | API                             | Meaning                                                                    |
| ------------------- | ------------------ | ------------------------------- | -------------------------------------------------------------------------- |
| **Discover**        | `/discover`        | `GET /api/catalog/works`        | Browse published official works                                            |
| **My Library**      | `/my-shelf`        | `GET /api/library`              | Owned works + explicitly saved Catalog works; Continue Reading is separate |
| **Reader**          | `/read/[workId]`   | `GET /api/reader/works/:workId` | Immersive reading session                                                  |
| **Reading History** | `/reading-history` | `GET /api/reading-history`      | Calm overview of reading activity                                          |

Part-scoped APIs: TTS / translate / assist use `partId` (+ `workId` for thread scope).

---

## Catalog supply boundary (AS-02)

Admin has no Work-management UI, API, service, preview, manual publication, or
per-Work audio operation. Users, including an Admin account holder, use
`POST /api/works` for private Personal EPUB Upload. Catalog and Reader read
surfaces continue to serve existing published Works. Future Catalog intake
requires a separately decided Source ingestion policy.

---

## Shared package and workflow policy

`@gloaming/shared` has no root public entrypoint. The only public entrypoints
are `@gloaming/shared/<module>` owning-module subpaths (ADR-003). Consumers must
import from the owning module; implementation deep imports such as
`@gloaming/shared/src/...` remain forbidden. Shared exposes cross-layer DTOs,
Zod schemas, controlled values, types, and pure functions. It does not own
backend queue, retry, lease, or workflow runtime policy.

`apps/backend` owns workflow policy and preserves the current auto-chaining /
auto-TTS **off** defaults (`WORKFLOW_AUTO_CHAIN = false`,
`TTS_STEP_ENABLED = false`). Reader audio playback may degrade gracefully when
an existing audio asset is temporarily unavailable. Instance TTS provider
configuration remains an Admin system surface; per-Work generation controls
were removed with the Admin Works module.

---

## Current code vs target (honest matrix)

**Historical Phase 3A** retired `Article` and introduced ReadingWork + `admin_epub` catalog intake. AS-02 removed that Admin intake path while preserving existing Catalog data and parser provenance.
**User-first** items below reflect the current repository unless marked **open**.

| Layer / concern          | Current (repository reality)                                                                                | Target (ADR-001 User-first)                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Content root             | **ReadingWork** / `reading_work` **done**                                                                   | same                                                  |
| Work pipeline field      | `processing_status` (migration 0036) **done** on schema + contracts                                         | no legacy `status` column                             |
| Publication              | `published_at` drives Catalog visibility **done**                                                           | publication never in `processing_status`              |
| Library membership table | `user_library_item` exists; migration 0036 backfilled prior state rows                                      | membership only in `user_library_item` + owned works  |
| Library API              | PR-05 implements `GET/POST/DELETE /api/library`; membership is union + explicit save                        | same; optional state decoration only                  |
| `reading_state` role     | progress and activity; API response is separate from membership                                             | position/status only; opening never saves             |
| Provider scope           | PR-06 工作树已实现解析器、Admin Instance 隔离及用户 `/api/settings/*` API；目标测试通过，全量测试环境待处理 | instance vs user on same tables                       |
| Discover API             | `GET /api/catalog/works` **done**                                                                           | same                                                  |
| Catalog supply           | Existing published Catalog Works remain readable; no new intake route after AS-02                           | future Source ingestion policy is a separate decision |
| Conversation subject     | `subject_type = reading_work` **done**                                                                      | same                                                  |
| Admin Works CMS          | removed in AS-02; historical Catalog data and provenance retained                                           | no Admin content-management surface                   |
| Legacy Remaining audit   | AS-02 runtime removal is scoped to Admin Works; other audit scope tracked separately                        | **0** for Admin Works Runtime                         |

Do **not** reintroduce Article names — see Retired names below.

---

## Shared API contracts

| Module                | Key types                                                         |
| --------------------- | ----------------------------------------------------------------- |
| `api/works` / catalog | `WorkSummary`, `DiscoverListData`, `Work`, `processingStatus`     |
| `api/library`         | `LibraryData`, `LibraryItem` (`work` + optional `state`)          |
| `api/reader`          | `ReaderSessionData`, `UpdateReadingStateBody`, `ReaderAudioTrack` |
| `api/reading-history` | `ReadingHistoryData`, completions with `workId`                   |
| `api/content-assets`  | Reader audio tracks and stable asset contracts                    |

---

## Content origins (MVP)

| `origin_kind`       | MVP              | Role                                                                         |
| ------------------- | ---------------- | ---------------------------------------------------------------------------- |
| `admin_epub`        | Historical only  | Provenance and parser support for existing Catalog records; no Admin intake  |
| `admin_text`        | Internal only    | Development/test fixture: 1 Work + 1 Part (`kind=body`); no runtime CMS path |
| `user_epub`         | Current Personal | `/api/works` → shared parser → private owner Work                            |
| Future source kinds | Deferred         | New Catalog intake awaits a separately decided Source policy                 |

---

## Retired names (do not reintroduce)

**Legacy content model**

- `Article`, `article`, `articleId`, `AdminArticle`
- `reading_progress`, `ReadingProgress`
- `article_audio`, `ArticleAudio`, `ArticleLevel`
- `seriesId`, `seriesOrder`, `ARTICLE_BODY_MAX_WORDS`
- `GET /api/articles`, `/api/admin/articles`, `/api/reader/articles/:articleId`
- `reading_work.status` with values `published` / `tts` as pipeline states
- Legacy shared root or deep imports — use `@gloaming/shared/<module>` owning
  module subpaths (ADR-003).

**Legacy product modules**

- `Learn*`, `/api/learn/*` — old Learning Platform
- `Progress*`, `/api/progress` — old progress dashboard
- `CatalogArticle*` — use `Discover*` / `WorkSummary`
- Short Article Library as product identity — see [`docs/archive/feature-short-article-library-v1.md`](../archive/feature-short-article-library-v1.md)

**Removed study loop (code gone)**

- Practice / Review modules, lesson/course entities as product surfaces

---

## Revision log

| Date       | Change                                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-28 | User-first vocabulary — Library vs State, `processing_status` / `published_at`, provider scope, honest current vs target matrix, admin catalog path target |
| 2026-09-28 | PR-04 — Personal EPUB ingestion and Catalog-only Admin route/API boundary; server workflow-step list filter                                                |
| 2026-09-30 | AS-02 — removed Admin Works CMS; preserved historical Catalog Works, `published_at`, and User Personal Upload                                              |
| 2026-08-24 | Phase 3A complete — ReadingWork domain; Article retired                                                                                                    |
| 2026-08-24 | Rewritten for ReadingWork domain (ADR-001); Article retired                                                                                                |
| 2026-08-24 | Prior version listed Article as MVP 1a entity.                                                                                                             |
| (revision) | Admin EPUB ingest marked shipped; publish default-US gate; auto-TTS remains off.                                                                           |
