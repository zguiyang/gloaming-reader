# Existing Feature Audit & Migration Plan

Code vs the **AI Native Language Reading Environment** bet and **ReadingWork** domain (ADR-001).

Related: [`mvp-scope.md`](./mvp-scope.md) · [`roadmap.md`](./roadmap.md) · [`engineering-vocabulary.md`](./engineering-vocabulary.md) · ADR-001 [`../adr/001-reading-content-domain-model.md`](../adr/001-reading-content-domain-model.md)

Audit date: **2026-08-24** (domain docs aligned; **Phase 3A complete** — ReadingWork SSOT in code).

**MVP 1 module SSOT:** [`mvp-1-modules.md`](./mvp-1-modules.md) — Phase **1a** = admin EPUB catalog → shelf; **1b** = user import (deferred).

---

## 1. Verdict legend

| Verdict      | Meaning                                                             |
| ------------ | ------------------------------------------------------------------- |
| **KEEP**     | Serves reading. Continue to invest.                                 |
| **REFACTOR** | Keep the capability; change shape (e.g. EPUB pipeline in Phase 3B). |
| **POSTPONE** | Not V1. Leave code; stop new features; hide from the default loop.  |
| **REMOVED**  | Deleted from the codebase. Do not reintroduce.                      |
| **DELETE**   | Legacy Article-era concepts — already removed in Phase 3A.          |

---

## 2. Existing feature audit

### 2.1 KEEP (ReadingWork-bound)

| Area                    | Where it lives                                      | Binding                                                |
| ----------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| Auth                    | Better Auth; `features/auth/**`; Hono `/api/auth/*` | Unchanged                                              |
| Reader (immersive)      | `features/reader/**`; route `/read/[workId]`        | Session over **ReadingWork** + current **ReadingPart** |
| Book detail             | `features/book-detail/**`; `/discover/[workId]`     | **ReadingWork** metadata                               |
| Discover                | `features/discover/**`                              | Published **ReadingWork** list                         |
| My shelf                | `features/shelf/**`                                 | **ReadingState** read model                            |
| Reading history         | `features/history/**`                               | Activity + completions by **workId**                   |
| Shared content chrome   | `features/content/content-model.ts`                 | Cover tints, paragraph split — no **ArticleLevel**     |
| App shell               | `features/app-shell/**`                             | Unchanged                                              |
| AI assist (in-text)     | `modules/assist/**`, `reader-ai-*`                  | **workId** + **partId** + selection                    |
| Assist transcripts      | `conversation` / `conversation_message`             | `subject_type = reading_work`                          |
| Translation / bilingual | `modules/translate/**`                              | **partId**-scoped cache                                |
| TTS + word timings      | `modules/tts/**` / `content-assets`                 | **ContentAsset** on **ReadingPart**                    |
| Reading position        | **`reading_state`**                                 | part + anchor; shelf membership                        |
| Reading history API     | `modules/reading-history/**`                        | Join **reading_work**                                  |
| LLM / TTS admin + logs  | `features/admin/ai-*`, `tts-*`                      | Ops — not learner                                      |
| Admin catalog ops       | `features/admin/works-*`                            | admin_text CMS; EPUB upload = Phase 3B                 |

### 2.2 Phase 3A migration — **done**

| Area              | Was (legacy)                                                                                         | Now (ADR-001)                             |
| ----------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Content root      | `article` table, single `body`                                                                       | `reading_work` + `reading_part`           |
| Derived audio     | `article_audio`                                                                                      | `content_asset` (`audio_us` / `audio_uk`) |
| Progress / shelf  | `reading_progress`                                                                                   | `reading_state`                           |
| Discover API      | `GET /api/articles`                                                                                  | `GET /api/catalog/works`                  |
| Reader API        | `/api/reader/articles/:articleId`                                                                    | `/api/reader/works/:workId`               |
| Admin API         | `/api/admin/articles`                                                                                | `/api/admin/works`                        |
| Shared types      | Legacy Article contracts retired; Shared exposes domain module subpaths                              | `@gloaming/shared/<module>` (ADR-003)     |
| Short-article era | [`docs/archive/feature-short-article-library-v1.md`](../archive/feature-short-article-library-v1.md) | **Archived** — not product                |

### 2.3 DELETE / REMOVED (do not reintroduce)

| Legacy concept              | Status                        |
| --------------------------- | ----------------------------- |
| `Article` / `article` table | Dropped in migration `0013`   |
| `article_audio`             | Replaced by **ContentAsset**  |
| `reading_progress`          | Replaced by **reading_state** |
| `ArticleLevel`, `seriesId`  | Not in schema                 |
| `ARTICLE_BODY_MAX_WORDS`    | Not in product                |
| Article API routes          | Gone — Work routes only       |

### 2.4 REMOVED (already deleted from codebase)

| Area                      | Why it conflicted           |
| ------------------------- | --------------------------- |
| **Practice system**       | Quiz loop / course identity |
| **Review system**         | Daily SRS-shaped queue      |
| **Learner Library page**  | → **发现**                  |
| **Learner learn-room UI** | → **Reader**                |
| **Progress / 成长 page**  | → **阅读历史**              |
| **Dashboard home route**  | → **我的书架**              |

No separate vocabulary/SRS product. Lookup “vocabulary card” is assist **format** only.

### 2.5 Missing vs V1 target (Phase 3B+)

| V1 must                          | Current state (Phase 3A done)                               |
| -------------------------------- | ----------------------------------------------------------- |
| Admin EPUB upload + processing   | **Absent** — Phase 3B; `admin_text` works for internal seed |
| ReadingWork + ReadingPart schema | **Done**                                                    |
| Chapter / part reader            | **Done** — multi-part ready; admin_text = 1 body part       |
| ContentAsset (origin + TTS)      | **Done** for part TTS; origin EPUB asset = Phase 3B         |
| User import                      | **Absent** (Phase 1b — correct to defer)                    |
| Learner UI wired to Work APIs    | **Done**                                                    |

---

## 3. Migration plan

Practice/Review **removal is done**. **Phase 3A** (Article → ReadingWork code migration) **is done**. **Phase 3B** = admin EPUB pipeline.

### 3.1 Domain decision — closed

**Open Question (Article vs document) is closed.**

**Decision:** ADR-001 accepted — **ReadingWork + ReadingPart + ReadingState + ContentAsset**. No Article extension. No compatibility layer.

### 3.2 Phase 3A execution order — complete

| Step | Layer             | Intent                                                          | Status |
| ---- | ----------------- | --------------------------------------------------------------- | ------ |
| 1    | `packages/db`     | New schema; drop `article`, `article_audio`, `reading_progress` | Done   |
| 2    | `packages/shared` | DTOs / Zod — `works`, `reader`, retire `articles`               | Done   |
| 3    | `apps/backend`    | `modules/works/**`; rebind assist/translate/tts                 | Done   |
| 4    | `apps/web`        | Routes `/read/[workId]`; features/admin/works-*                 | Done   |
| 5    | Tests             | Functional specs on Work model                                  | Done   |

### 3.3 What not to do

- Do not rebuild Practice/Review.
- Do not add `article` alias routes or Article \| Work union types.
- Do not reintroduce Article as content root.
- Do not treat Short Article Library as product ([`docs/archive/`](../archive/README.md)).

---

## 4. Engineering notes

### 4.1 Content model — **Accepted (ADR-001)**

One **ReadingWork** with ordered **ReadingPart** rows. Short text = 1 part (`kind=body`). EPUB = N parts (`kind=chapter`). Future sources = new `origin_kind` + processors — same tables.

See [`engineering-vocabulary.md`](./engineering-vocabulary.md) for product ↔ engineering map.

### 4.2 Module priority

| Keep investing                                 | Phase 3B                     | Gone forever     |
| ---------------------------------------------- | ---------------------------- | ---------------- |
| `features/reader/**`, assist, translate, tts   | Admin EPUB upload pipeline   | practice, review |
| Auth, admin LLM/TTS config                     | Origin ContentAsset for EPUB | Learn* modules   |
| `conversation` (`subject_type = reading_work`) | —                            | Article as SSOT  |

### 4.3 Shared package and workflow policy

`@gloaming/shared` has no root public entrypoint. The only public entrypoints
are `@gloaming/shared/<module>` owning-module subpaths (ADR-003). Consumers must
import from the owning module; implementation deep imports such as
`@gloaming/shared/src/...` remain forbidden. Shared exposes cross-layer DTOs,
Zod schemas, controlled values, types, and pure functions; application workflow
flags and queue/retry/lease behavior remain owned by the backend layer.

The backend owns runtime workflow policy and keeps the current defaults as a
manual pipeline with TTS disabled. Admin work and work-summary responses expose
the backend policy as a read-only projection so the management UI displays the
actual mode instead of inferring it from compile-time constants. This boundary
does not change the ADR-001 `ReadingWork` / `ReadingPart` / `ReadingState` /
`ContentAsset` model or the `admin_epub` / `admin_text` origin boundary.

---

## 5. Revision log

| Date       | Change                                                                 |
| ---------- | ---------------------------------------------------------------------- |
| 2026-08-24 | Phase 3A marked complete; KEEP/REFACTOR tables use current Work paths. |
| 2026-08-24 | ADR-001 alignment; Open Question closed; Phase 3 order; DELETE list.   |
| 2026-08-23 | Frontend learner cleanup; library/progress removed.                    |
| 2026-08-20 | Practice/Review removed; initial reading-environment audit.            |
