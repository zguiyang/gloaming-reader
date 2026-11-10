# Engineering vocabulary

Gloaming uses **product language** in UX and **engineering language** in code/APIs. This doc maps the two.

**Domain SSOT:** [`docs/adr/001-reading-content-domain-model.md`](../adr/001-reading-content-domain-model.md)

---

## Domain model (ADR-001)

| Product concept (UX)          | Engineering entity  | Table / module                                                  |
| ----------------------------- | ------------------- | --------------------------------------------------------------- |
| 一本书 / 一份阅读内容         | **ReadingWork**     | `reading_work`                                                  |
| 章节 / 阅读单元               | **ReadingPart**     | `reading_part`                                                  |
| 保存到我的书库 / Library 成员 | **UserLibraryItem** | `user_library_item` (explicit catalog membership)               |
| 阅读进度与位置                | **ReadingState**    | `reading_state` (progress only)                                 |
| 来源书目 (not readable)       | **SourceRecord**    | local bibliography per source; never served as reading content  |
| 文件 / 音频等资源             | **ContentAsset**    | `content_asset`                                                 |
| AI 对话（本书上下文）         | **Conversation**    | `conversation` (`subject_type = reading_work`)                  |
| 我的书库 (My Library)         | **Library**         | Read model — owned works ∪ `user_library_item`                  |
| 继续阅读                      | **ContinueReading** | Read model — `reading_state` position, separate from membership |

**Invariants:** saving does not start progress; removing membership retains progress; personal EPUB works are user-owned and private.

UI copy may still say **书 / Book / 封面 / 章节** — intentional user metaphor, not legacy engineering names.

### ReadingWork status vocabulary

| Concept              | Field / API         | Values / rule                                                          |
| -------------------- | ------------------- | ---------------------------------------------------------------------- |
| Pipeline progress    | `processing_status` | `uploaded`, `processing`, `parsed`, `metadata`, `ready`, `failed` only |
| Published to catalog | `published_at`      | non-null timestamp = catalog eligible; Discover filters this field     |

Do **not** use `published` as a `processing_status` value.

### Provider / settings scope

| Scope    | `owner_user_id` | Tables                                          |
| -------- | --------------- | ----------------------------------------------- |
| Instance | `NULL`          | `llm_provider`, `llm_app_setting`, `tts_config` |
| User     | user id         | same tables — no duplicate `user_llm_*` tables  |

---

## Product surfaces (user-facing)

| Surface      | Route              | API                                                            | Meaning                                                        |
| ------------ | ------------------ | -------------------------------------------------------------- | -------------------------------------------------------------- |
| **Library**  | `/library`         | `GET /api/library`                                             | Owned works ∪ explicit saved items                             |
| **Discover** | `/discover`        | `GET /api/discover/records`; existing `GET /api/catalog/works` | Source bibliography and published Work reads have distinct IDs |
| **Reader**   | `/read/[workId]`   | `GET /api/reader/works/:workId`                                | Immersive reading session                                      |
| **History**  | `/reading-history` | `GET /api/reading-history`                                     | Calm overview of reading activity                              |
| Work detail  | `/works/[workId]`  | shared detail route                                            | Title/cover/meta; Read → `/read/[id]`                          |

Part-scoped APIs: TTS / translate / assist use `partId` (+ `workId` for thread scope). Lazy reader audio is Part-scoped too: `GET /api/reader/parts/:partId/audio/manifest`, `GET /api/reader/parts/:partId/audio/segments/:index`, and `GET /api/reader/parts/:partId/audio/segments/:index/audio` synthesize and serve per-segment audio on demand.

**Library filter:** source + tag combined (AND), reflected in the URL; today it operates on a client-loaded subset, not full pagination.

---

## Content supply boundary

Supply policy SSOT: [`content-strategy.md`](./content-strategy.md). Accepted direction: Hybrid source sync (local **SourceRecord** metadata; EPUB materialized only on save/read intent). Personal EPUB uploads use `POST /api/works` and remain user-owned and private. Admin has no Work-management surface.

---

## Shared package and workflow policy

`@gloaming/shared` has no root public entrypoint; the only public entrypoints are `@gloaming/shared/<module>` owning-module subpaths (ADR-003). Deep imports such as `@gloaming/shared/src/...` are forbidden. Shared exposes cross-layer DTOs, schemas, types, and pure functions; it does not own backend queue, retry, lease, or workflow runtime policy.

`apps/backend` owns workflow policy and preserves auto-chaining **off** defaults (`WORKFLOW_AUTO_CHAIN = false`). Reader audio is generated lazily per segment at read time (no pre-generated whole-chapter audio assets, no workflow `tts` step) and degrades gracefully, for example when the speech provider is unavailable.

---

## Current code vs target (honest matrix)

| Layer / concern          | Current (repository reality)                                                    | Target (ADR-001)                               |
| ------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------- |
| Content root             | **ReadingWork** / `reading_work` **done**                                       | same                                           |
| Work pipeline field      | `processing_status` **done**                                                    | no legacy `status` column                      |
| Publication              | `published_at` drives catalog visibility **done**                               | never in `processing_status`                   |
| Library membership       | `user_library_item` + owned works **done**                                      | same; membership only                          |
| `reading_state` role     | progress and activity; separate from membership                                 | position only; opening never saves             |
| Source intake            | SourceRecord and save/import code exist; real user-loop acceptance remains open | metadata local, EPUB on intent                 |
| Discover API             | SourceRecord API and Catalog Work API coexist                                   | SourceRecord IDs never substitute for Work IDs |
| Conversation subject     | `subject_type = reading_work` **done**                                          | same                                           |
| Admin content management | removed                                                                         | no Admin content-management surface            |

---

## Content origins

| `origin_kind`     | Role                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------- |
| `NULL`            | Catalog work; no source identity claimed                                                |
| `user_epub`       | `/api/works` → shared EPUB parser → private owner Work                                  |
| Source provenance | Stored on the linked SourceRecord; no additional Work origin kind is currently declared |

---

## Retired names (do not reintroduce)

- `Article`, `articleId`, `AdminArticle`; `reading_progress`; `article_audio`, `ArticleLevel`
- `seriesId`, `seriesOrder`, `ARTICLE_BODY_MAX_WORDS`
- `GET /api/articles`, `/api/admin/articles`, `/api/reader/articles/:articleId`
- `reading_work.status` values `published` / `tts` as pipeline states
- Legacy shared root or deep imports — use `@gloaming/shared/<module>` subpaths (ADR-003)
- `Learn*`, `/api/learn/*`; `Progress*`, `/api/progress`; `CatalogArticle*`
- Short Article Library as product identity
- Practice / Review modules; lesson/course entities as product surfaces
