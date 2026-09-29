# ADR-001: Reading Content Domain Model

**Status:** Accepted / Frozen (amended 2026-09-28 — User-first)
**Date:** 2026-08-24  
**Scope:** Core content domain — replaces the legacy `Article` model

Related: [`engineering-vocabulary.md`](../product/engineering-vocabulary.md) · [`content-strategy.md`](../product/content-strategy.md) · [`user-first-architecture-implementation.md`](../plans/user-first-architecture-implementation.md)

---

## Context

Gloaming moved from an **AI-generated short-article learning platform** to an **AI Native Language Reading Environment**. The codebase still centered on `Article` (300-word cap, single `body`, level/series metadata), which conflicted with product docs (document-first, EPUB chapters, multiple future sources).

There are **no production users** and **no historical data compatibility** requirement. The team chose correctness over incremental extension of `Article`.

**User-first amendment (2026-09-28):** Reading membership (Library), work pipeline status, publication, and per-user provider settings were conflated in early ADR-001 text (`reading_work.status` mixing pipeline + publish; `reading_state` implied shelf membership). This amendment locks the split below and supersedes conflicting clauses in the original decision and entity sections.

---

## Decision

1. **Retire `Article`** as the content root — no extension, no alias, no compatibility layer.
2. Adopt **`ReadingWork` + `ReadingPart`** as the only reading content structure.
3. Adopt **`UserLibraryItem`** for Library membership (user × work). **Do not** infer membership from `reading_state`.
4. Adopt **`ReadingState`** for reading progress and position only (replaces `reading_progress`). Removing a work from Library **does not** delete `reading_state`.
5. Adopt **`ContentAsset`** for source files and derived resources (replaces `article_audio`).
6. Keep **`Conversation`**; `subject_type = reading_work`, `subject_id = work.id`.
7. Treat **`My Library`** as a **read-model aggregate**: works the user **owns** (`reading_work.owner_user_id = user`) **UNION** works explicitly saved via **`user_library_item`** (typically catalog works). **Continue Reading** is a separate projection of accessible in-progress `reading_state` and may contain an unsaved work.
8. **MVP primary supply:** `admin_epub` (Admin EPUB upload → processing → publish).
9. **`admin_text`:** internal fallback only (dev/test/seed) — **not** a product capability.
10. **Provider settings (User-first):** `llm_provider`, `llm_app_setting`, and `tts_config` are scoped by **`owner_user_id`**: `NULL` = instance (platform) scope; non-`NULL` = that user’s scope. **Do not** introduce parallel `user_llm_*` tables.

---

## Domain entities

### ReadingWork (`reading_work`)

**User concept:** A book / piece of reading content.  
**Responsibility:** Metadata, source, pipeline processing, visibility, ownership — **no body text**.

**Processing lifecycle (`processing_status` only):**

Nominal happy path: `uploaded` → `processing` → `parsed` → `metadata` → `ready`.

`failed` may be set when **any** pipeline/worker step errors — it is **not** a stage that follows only `ready` on a single linear timeline. A work may remain in `failed` until retry or admin intervention.

Allowed values **only:** `uploaded`, `processing`, `parsed`, `metadata`, `ready`, `failed`.
TTS is a **workflow step** (`origin_meta` / worker), not a `processing_status` value.

**Publication:** expressed by **`published_at`** (timestamp, nullable).
`published_at IS NOT NULL` means published to the surfaces that respect catalog publication; it is **not** a processing status.

**Key fields:** `id`, `title`, `description`, `language`, `processing_status`, `visibility`, `owner_user_id` (null = official catalog work; non-null = user-owned work), `origin_kind`, `origin_meta`, tags/category/sources (normalized), `cover_asset_id`, `published_at`, timestamps. Channel providers live on the `source` dimension via `reading_work_source`.

**Forbidden on Work:** `level`, `seriesId`, `body` (legacy Article concepts); a single column mixing pipeline and publication (legacy `status` with `published` / `tts`).

**Derived stats (allowed):** `wordCount`, `estimatedMinutes`, `suggestedVocabSize`, `difficultyScore`, `statsProvenance` — computed at parse time or set manually by admin.

### ReadingPart (`reading_part`)

**User concept:** Chapter / reading unit.  
**Responsibility:** Ordered readable text — SSOT for Reader, TTS, Translate, Assist context.

**Relationship:** N parts per Work (`work_id` + `sort_order` UNIQUE).

**Key fields:** `id`, `work_id`, `sort_order`, `kind`, `title`, `body`, `meta`.

**MVP `kind`:** `chapter`, `body`. **Reserved:** `section`, `segment`.

### UserLibraryItem (`user_library_item`)

**User concept:** “Saved to My Library” for a catalog (or other) work the user does not own.
**Responsibility:** Library **membership** only — not reading position.

**Uniqueness:** `(user_id, work_id)` UNIQUE.

**Key fields:** `id`, `user_id`, `work_id`, `created_at`.

**Invariant:** Deleting or removing a library row does **not** cascade-delete `reading_state` for that user and work.

### ReadingState (`reading_state`)

**User concept:** Where I am in the book and whether I finished it.
**Responsibility:** Reading position and reading status — **not** Library membership.

**Lifecycle:** row may exist without library membership; status typically `in_progress` → `completed`.

**Key fields:** `id`, `user_id`, `work_id`, `current_part_id`, `completed_through_sort_order`, `revision`, `anchor_kind`, `anchor_value`, `status`, `added_at`, `last_read_at`, `completed_at`.

**Note:** `progressRatio` is **computed** for UI — not persisted. Legacy `added_at` remains for history ordering; it does **not** define Library membership after User-first.

### ContentAsset (`content_asset`)

**Responsibility:** Unified storage for EPUB originals, covers, TTS audio, future derivatives.

**Key fields:** `id`, `work_id?`, `part_id?`, `kind`, `storage_key`, `mime_type`, `content_hash`, `meta`, `status`, timestamps.

**MVP `kind`:** `origin_file`, `audio_us`, `audio_uk`.

### Conversation (unchanged shape)

**Change only:** `subject_type = 'reading_work'`, `subject_id = work.id`.

**Assist context:** `workId` + `partId` + `selection`.

### My Library & Shelf (read models)

**Not a single “membership” table on `reading_state`.**

**My Library (target composition):**

```text
LibraryWorks(user) =
  { work | work.owner_user_id = user }
  ∪
  { work | EXISTS user_library_item(user, work) }
```

**Library / Continue Reading (read model):** Library items are owned works union explicitly saved Catalog works. Their `reading_state` is an optional progress decoration. Continue Reading is queried independently from accessible `reading_state` rows and may include an unsaved Catalog work; reading never creates Library membership.

---

## Admin catalog routing (target)

**Target (User-first):** Admin catalog management lives at **`/admin/catalog/works`** (web) and **`/api/admin/catalog/works`** (API). Legacy **`/admin/works`** and **`/api/admin/works`** are removed after migration.

**Current reality (PR-04):** Admin catalog pages are mounted under **`/admin/catalog/works`** and APIs under **`/api/admin/catalog/works`**, including Work- and Part-scoped audio operations. The former `/admin/works`, `/api/admin/works`, and `/api/admin/parts/:partId/audio*` routes have no aliases. Catalog reads and mutations require `owner_user_id IS NULL AND visibility = 'catalog'`.

---

## Migration boundary

### User-first schema foundation (PR-01 — landed on branch; follow-on epic open)

| Area             | Scope                                                                                                                          | PR-01 status                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Schema           | `processing_status` on `reading_work`; drop legacy `status`; `user_library_item`; `owner_user_id` on LLM/TTS config tables     | **done** (migration `0036`, constraint tests **4/4** on `gloaming_test`)                                                     |
| Data backfill    | Map old `status` → `processing_status`; seed `user_library_item` from existing `reading_state` rows (membership backfill only) | **done** in migration                                                                                                        |
| Shared contracts | `processingStatus`, `publicationStatus` list filters; `publishedAt` on work DTOs                                               | **done** (`works.spec.ts` **14/14**)                                                                                         |
| Backend          | Admin list/read uses new columns; pipeline commands write `processing_status`                                                  | **partial** — `works-epub` **19/19**; **no** Library API; **no** user read-access gates; **no** provider scope runtime audit |
| Web admin        | Work list/edit uses `processingStatus` / `publishedAt`                                                                         | **partial** — targeted specs **33/33**; routes still `/admin/works`; TTS “busy” tab taxonomy **open** (Catalog/Ingest)       |

**Not claimed complete in PR-01:** user read authorization (Access), Library CRUD/shelf union, `/admin/catalog/works` routing, provider `owner_user_id` query behavior, settings UI scope, Legacy Remaining = 0.

### Implement in MVP (Phase 3 — content domain)

| Area                      | Scope                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------- |
| Schema                    | `reading_work`, `reading_part`, `reading_state`, `content_asset`; drop article tables |
| Admin supply              | EPUB upload → processing → parts → publish                                            |
| Discover / Shelf / Reader | Work + Part + State                                                                   |
| Assist / Translate / TTS  | Part-scoped text                                                                      |
| `admin_text` fallback     | 1 work + 1 part (`kind=body`) for dev/test only                                       |

### Reserved / follow-on (User-first epic)

| Area                                       | Reserved via                                                                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Personal EPUB upload                       | `POST /api/works`; `owner_user_id`, `visibility=private`, `origin_kind=user_epub`; shared EPUB parser; no Library membership |
| User PDF / web / video / podcast           | Future `origin_kind`, `part.kind`, `part.meta`                                                                               |
| Library CRUD APIs & owned/saved read model | `user_library_item` + read models                                                                                            |
| Vocabulary product / RAG tables            | Conversation message IDs as future pointers                                                                                  |

---

## Alternatives considered

| Option                                          | Rejected because                                               |
| ----------------------------------------------- | -------------------------------------------------------------- |
| Extend `article` with long body / JSON chapters | Wrong semantics; derived resources stay article-bound          |
| Parallel `document` + keep `article`            | Two reading types — violates content-strategy                  |
| Flat single-table content                       | No chapter boundary for TTS/progress/assist                    |
| `reading_state` as shelf membership             | User-first: conflates membership with reading position         |
| `reading_work.status` including `published`     | User-first: publication is `published_at` only                 |
| Separate `user_llm_*` tables                    | Duplicate config model; use `owner_user_id` on existing tables |
| Keep `/api/articles` alias                      | Perpetuates dual model                                         |

---

## Consequences

**Positive**

- One content model for EPUB, future imports, and internal `admin_text` seed.
- Clear boundaries: Work (catalog/metadata/pipeline) vs Part (read/TTS/translate) vs Library (membership) vs State (position).
- Phase 3 / User-first migration path: db → shared → backend → tests → web.

**Negative**

- Full-stack breaking change (acceptable — no users).
- Admin ops shifts from paste-form identity to EPUB pipeline.
- Transitional dual semantics until Library APIs and admin route migration complete.

**Implementation order:** `packages/db` → `packages/shared` → `apps/backend` → tests → `apps/web`.

**Epic closeout (User-first):** **Legacy Remaining = 0** — no legacy route aliases, no Article-era names in active code paths, no conflated status/membership semantics in SSOT or production contracts. Tracked in [`user-first-architecture-implementation.md`](../plans/user-first-architecture-implementation.md).

---

## Revision log

| Date       | Change                                                                                                                                                                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-28 | **PR-04 implementation** — shared EPUB ingest core; Personal `user_epub` upload/read boundary; Catalog-only Admin namespace; server TTS workflow filter                                                                                              |
| 2026-09-28 | **User-first amendment** — `processing_status` + `published_at`; `user_library_item`; `reading_state` = position only; provider `owner_user_id`; target admin catalog paths; supersede shelf-on-state clauses; clarify `failed` at any pipeline step |
| 2026-08-24 | Initial ADR — frozen at Phase 1 domain alignment                                                                                                                                                                                                     |
