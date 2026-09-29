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
| Published to catalog | `published_at`      | non-null timestamp = published; filter as `publicationStatus` on admin lists |
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

## Admin catalog (target and current)

| Concern        | Current code (PR-04)                 | Boundary                                                     |
| -------------- | ------------------------------------ | ------------------------------------------------------------ |
| Web routes     | `/admin/catalog/works`, …            | Legacy `/admin/works` has no alias                           |
| Admin API      | `/api/admin/catalog/works`, …        | Catalog Works only; ownerless and `visibility=catalog`       |
| Audio API      | Work- and Part-scoped Catalog routes | Personal Works return not found                              |
| Feature folder | `features/admin/works/…`             | Internal module name; route path defines the product surface |

Treat **target** paths as the epic end state. PR-01 does **not** complete admin route renaming.

---

## Shared package and workflow policy

`@gloaming/shared` has no root public entrypoint. The only public entrypoints
are `@gloaming/shared/<module>` owning-module subpaths (ADR-003). Consumers must
import from the owning module; implementation deep imports such as
`@gloaming/shared/src/...` remain forbidden. Shared exposes cross-layer DTOs,
Zod schemas, controlled values, types, and pure functions. It does not own
backend queue, retry, lease, or workflow runtime policy.

`apps/backend` owns workflow policy and preserves the current manual pipeline
and auto-chaining / auto-TTS **off** defaults (`WORKFLOW_AUTO_CHAIN = false`,
`TTS_STEP_ENABLED = false`). Admin work responses expose a read-only policy
projection for the management UI; Web code must render that projection rather
than infer runtime behavior from shared compile-time flags.

**Publish gate:** Before `publishWork`, every part with synthesizable text must
have **ready default US** (`audio_us`, `PUBLISH_DEFAULT_AUDIO_ROLE = us`) whose
`content_hash` matches the current part body. UK (`audio_uk`) is optional.
Operators generate default US through admin TTS actions and the worker queue.
Reader playback may degrade gracefully when audio is temporarily unavailable.

---

## Current code vs target (honest matrix)

**Phase 3A** retired `Article` and shipped ReadingWork + `admin_epub`. That remains true.
**User-first** items below reflect the current repository unless marked **open**.

| Layer / concern          | Current (repository reality)                                                                                | Target (ADR-001 User-first)                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Content root             | **ReadingWork** / `reading_work` **done**                                                                   | same                                                 |
| Work pipeline field      | `processing_status` (migration 0036) **done** on schema + contracts                                         | no legacy `status` column                            |
| Publication              | `published_at` + `publicationStatus` admin filter **done**                                                  | publication never in `processing_status`             |
| Library membership table | `user_library_item` exists; migration 0036 backfilled prior state rows                                      | membership only in `user_library_item` + owned works |
| Library API              | PR-05 implements `GET/POST/DELETE /api/library`; membership is union + explicit save                        | same; optional state decoration only                 |
| `reading_state` role     | progress and activity; API response is separate from membership                                             | position/status only; opening never saves            |
| Provider scope           | PR-06 工作树已实现解析器、Admin Instance 隔离及用户 `/api/settings/*` API；目标测试通过，全量测试环境待处理 | instance vs user on same tables                      |
| Discover API             | `GET /api/catalog/works` **done**                                                                           | same                                                 |
| Admin CMS API (path)     | `/api/admin/catalog/works` **done**; Catalog-only query/mutation boundary                                   | same                                                 |
| Admin CMS UI (path)      | `/admin/catalog/works` **done**                                                                             | same                                                 |
| Conversation subject     | `subject_type = reading_work` **done**                                                                      | same                                                 |
| Admin “busy” list + TTS  | server `workflowStep=tts` filter **done**                                                                   | UI and server share status/workflow-step query       |
| Legacy Remaining audit   | not closed **open**                                                                                         | **0** at epic closeout                               |

Do **not** reintroduce Article names — see Retired names below.

---

## Shared API contracts

| Module                | Key types                                                          |
| --------------------- | ------------------------------------------------------------------ |
| `api/works` / catalog | `WorkSummary`, `DiscoverListData`, `AdminWork`, `processingStatus` |
| `api/library`         | `LibraryData`, `LibraryItem` (`work` + optional `state`)           |
| `api/reader`          | `ReaderSessionData`, `UpdateReadingStateBody`, `ReaderAudioTrack`  |
| `api/reading-history` | `ReadingHistoryData`, completions with `workId`                    |
| `api/content-assets`  | Part/work asset views (TTS admin)                                  |

---

## Content origins (MVP)

| `origin_kind`        | MVP                | Role                                                                          |
| -------------------- | ------------------ | ----------------------------------------------------------------------------- |
| `admin_epub`         | **Yes — primary**  | Official catalog supply: upload → process → publish                           |
| `admin_text`         | Internal only      | Dev/test seed: 1 work + 1 part (`kind=body`); **not** product identity        |
| `user_epub`          | **Yes — Personal** | `/api/works` → shared parser → private owner Work; no publish or Library step |
| `user_pdf`, `web`, … | No (follow-on)     | Future source kinds; not implemented                                          |

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
| 2026-08-24 | Phase 3A complete — ReadingWork domain; Article retired                                                                                                    |
| 2026-08-24 | Rewritten for ReadingWork domain (ADR-001); Article retired                                                                                                |
| 2026-08-24 | Prior version listed Article as MVP 1a entity.                                                                                                             |
| (revision) | Admin EPUB ingest marked shipped; publish default-US gate; auto-TTS remains off.                                                                           |
