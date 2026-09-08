# Engineering vocabulary

Gloaming uses **product language** in UX and **engineering language** in code/APIs. This doc maps the two and records the **Reading Content** domain (ADR-001).

**Domain SSOT:** [`docs/adr/001-reading-content-domain-model.md`](../adr/001-reading-content-domain-model.md)

---

## Domain model

| Product concept (UX)        | Engineering entity | Table / module (target)                                     |
| --------------------------- | ------------------ | ----------------------------------------------------------- |
| 一本书 / 一份阅读内容       | **ReadingWork**    | `reading_work`                                              |
| 章节 / 阅读单元             | **ReadingPart**    | `reading_part`                                              |
| 我的阅读状态 / 书架上的进度 | **ReadingState**   | `reading_state`                                             |
| 文件 / 音频等资源           | **ContentAsset**   | `content_asset`                                             |
| AI 对话（本书上下文）       | **Conversation**   | `conversation` (`subject_type = reading_work`)              |
| 我的书架                    | **Shelf**          | Read model — `reading_state` JOIN `reading_work` (no table) |

UI copy may still say **书 / Book / 封面 / 章节** — intentional user metaphor, not legacy engineering names.

---

## Product surfaces (user-facing)

| Surface             | Route              | API                             | Meaning                           |
| ------------------- | ------------------ | ------------------------------- | --------------------------------- |
| **Discover**        | `/discover`        | `GET /api/catalog/works`        | Browse published official works   |
| **Shelf**           | `/my-shelf`        | `GET /api/shelf`                | Continue reading + shelf items    |
| **Reader**          | `/read/[workId]`   | `GET /api/reader/works/:workId` | Immersive reading session         |
| **Reading History** | `/reading-history` | `GET /api/reading-history`      | Calm overview of reading activity |

Part-scoped APIs: TTS / translate / assist use `partId` (+ `workId` for thread scope).

---

## Shared package and workflow policy

`@gloaming/shared` has no root public entrypoint. The only public entrypoints
are `@gloaming/shared/<module>` owning-module subpaths (ADR-003). Consumers must
import from the owning module; implementation deep imports such as
`@gloaming/shared/src/...` remain forbidden. Shared exposes cross-layer DTOs,
Zod schemas, controlled values, types, and pure functions. It does not own
backend queue, retry, lease, or workflow runtime policy.

`apps/backend` owns workflow policy and preserves the current manual pipeline
and TTS-off defaults. Admin work responses expose a read-only policy projection
for the management UI; Web code must render that projection rather than infer
runtime behavior from shared compile-time flags. This separation leaves the
ADR-001 `ReadingWork` / `ReadingPart` / `ReadingState` / `ContentAsset` model
and the `admin_epub` / `admin_text` origin boundary unchanged.

---

## Current code = target domain (Phase 3A)

| Layer                | Current (= Target, ADR-001)                       |
| -------------------- | ------------------------------------------------- |
| Content root         | **ReadingWork** / `reading_work`                  |
| Text body            | **ReadingPart.body** (ordered parts)              |
| Shelf / progress     | **ReadingState** / `reading_state`                |
| TTS / audio rows     | **ContentAsset** (`kind = audio_us` / `audio_uk`) |
| Discover API         | `GET /api/catalog/works`                          |
| Admin CMS            | `/api/admin/works`                                |
| Reader API           | `/api/reader/works/:workId`                       |
| Conversation subject | `subject_type = reading_work`                     |

**Phase 3A complete.** Do **not** reintroduce Article names — see Retired names below. **Phase 3B** = admin EPUB ingest.

---

## Shared API contracts

| Module                | Key types                                                         |
| --------------------- | ----------------------------------------------------------------- |
| `api/works` / catalog | `WorkSummary`, `DiscoverListData`, `AdminWork`                    |
| `api/shelf`           | `ShelfData`, `ShelfItem` (`work` + `state`, not `article`)        |
| `api/reader`          | `ReaderSessionData`, `UpdateReadingStateBody`, `ReaderAudioTrack` |
| `api/reading-history` | `ReadingHistoryData`, completions with `workId`                   |
| `api/content-assets`  | Part/work asset views (TTS admin)                                 |

---

## Content origins (MVP)

| `origin_kind`                     | MVP               | Role                                                                   |
| --------------------------------- | ----------------- | ---------------------------------------------------------------------- |
| `admin_epub`                      | **Yes — primary** | Official catalog supply: upload → process → publish                    |
| `admin_text`                      | Internal only     | Dev/test seed: 1 work + 1 part (`kind=body`); **not** product identity |
| `user_epub`, `user_pdf`, `web`, … | No (Phase 1b+)    | Reserved in schema; not implemented in MVP                             |

---

## Retired names (do not reintroduce)

**Legacy content model**

- `Article`, `article`, `articleId`, `AdminArticle`
- `reading_progress`, `ReadingProgress`
- `article_audio`, `ArticleAudio`, `ArticleLevel`
- `seriesId`, `seriesOrder`, `ARTICLE_BODY_MAX_WORDS`
- `GET /api/articles`, `/api/admin/articles`, `/api/reader/articles/:articleId`
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

| Date       | Change                                                                          |
| ---------- | ------------------------------------------------------------------------------- |
| 2026-08-24 | Phase 3A complete — Current = Target API/domain table; forbidden list retained. |
| 2026-08-24 | Rewritten for ReadingWork domain (ADR-001); Article retired; target API table.  |
| 2026-08-24 | Prior version listed Article as MVP 1a entity.                                  |
