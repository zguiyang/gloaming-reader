# Gloaming Content Strategy

SSOT for **what people read** and **how it enters Gloaming**—under the AI Native Language Reading Environment bet.

Related: [`mvp-scope.md`](./mvp-scope.md) · [`mvp-1-modules.md`](./mvp-1-modules.md) · [`engineering-vocabulary.md`](./engineering-vocabulary.md) · ADR-001 [`../adr/001-reading-content-domain-model.md`](../adr/001-reading-content-domain-model.md)

**Language:** Product docs are English. User-facing copy may be Chinese.

---

## 1. Purpose of content

Content exists so someone can **read real English**.

Gloaming is not a corpus-building project, not a course publisher, and not an AI writing mill.

**MVP supply (Phase 1a):** official **ReadingWork** catalog via admin EPUB upload → **发现** → **我的书架**.  
**Later (Phase 1b):** users bring their own files (import).  
**Never:** generated “learning English” articles as the product. Gloaming does not manufacture learning materials.

---

## 2. Scope decisions (locked)

| Decision                       | Stance                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| MVP 1 primary supply           | **Admin EPUB upload** → processing → **ReadingWork** + **ReadingPart[]** → publish → Discover               |
| User import                    | **Phase 1b** — deferred; not required for MVP 1                                                             |
| Real content pipeline (EPUB)   | **In MVP 1a (admin)** — clean EPUB, organize chapters, present like a book; do **not** rewrite into lessons |
| Official catalog               | Team-owned or licensed EPUBs; feed **发现**                                                                 |
| `admin_text` fallback          | **Internal only** — dev/test/seed; see §2.1; **not** Short Article Library                                  |
| Scraping / crawl               | **Out**                                                                                                     |
| AI rewrite into graded lessons | **Out** — content generator                                                                                 |
| AI at read time                | Explain / translate / TTS on **this part** of **this work**                                                 |
| Memes / syllabus trees         | **Out** of identity                                                                                         |
| User-generated marketplace     | **Out** of MVP 1                                                                                            |

Module SSOT: [`mvp-1-modules.md`](./mvp-1-modules.md).

### 2.1 `admin_text` (internal fallback — not product)

`admin_text` creates **ReadingWork + one ReadingPart (`kind=body`)** from a title + body paste. Use for:

- Development and migration testing
- Automated test fixtures
- Demo seed without uploading EPUB every time

**It is not:**

- The Short Article Library product (archived — [`docs/archive/feature-short-article-library-v1.md`](../archive/feature-short-article-library-v1.md))
- What learners should see as the main catalog story
- A reason to keep `Article`, `level`, `seriesId`, or 300-word caps

Gloaming’s content identity is **ReadingWork**, not short articles.

---

## 3. What “authentic” means here

Authentic = **not manufactured as a Gloaming lesson**.

Examples that fit:

- A licensed EPUB the team publishes to Discover
- A book the user imports (Phase 1b)
- An essay they saved (when import supports it)

Examples that do not:

- AI-written “B1 daily story” farms
- Dialogue drills
- Vocab-pack paragraphs

Difficulty is handled by **help on the page**, not by only shipping easy fables.

---

## 4. Reading content shape (product contract)

The reading atom is a **ReadingWork** the user is in the middle of—not “today’s 250-word unit.”

### 4.1 Domain entities (ADR-001)

| Entity           | User concept  | Responsibility                                                     |
| ---------------- | ------------- | ------------------------------------------------------------------ |
| **ReadingWork**  | 书 / 阅读内容 | Metadata, source, publish status, visibility — **no body**         |
| **ReadingPart**  | 章节          | Ordered text — Reader / TTS / Translate / Assist boundary          |
| **ReadingState** | 阅读进度状态  | Per user × work position; never Library membership                 |
| **ContentAsset** | (internal)    | EPUB file, cover, TTS audio, future derivatives                    |
| **Conversation** | AI 帮助       | Thread scoped to `reading_work`                                    |
| **My Library**   | 我的书库      | Owned works + explicitly saved Catalog works; progress is optional |

**Product rule:** one kind of thing you read — not Article-the-lesson plus Book-the-other-app.

### 4.2 Work fields (intent)

| Concern                       | Need                                   |
| ----------------------------- | -------------------------------------- |
| Title, description, language  | Yes                                    |
| Ordered parts (chapters)      | Yes for EPUB                           |
| `origin_kind` / `origin_meta` | Yes — source SSOT                      |
| Owner / visibility            | Official catalog vs user (1b)          |
| Reading position              | Per user × work (+ part + anchor)      |
| Tags                          | Optional metadata — **not** a syllabus |

**Forbidden on Work:** `level`, `seriesId`, `estimatedMinutes`, single `body` blob.

### 4.3 Length

No 300-word cap on EPUB works. Part bodies are bounded by engineering limits only.

---

## 5. End-to-end flows

### 5.1 Primary — Admin EPUB (MVP)

```text
Admin upload EPUB
  → ReadingWork (draft → processing)
  → Parse → ReadingPart[] (chapters)
  → ContentAsset (origin_file)
  → Publish
  → 发现 → 加入书架 → Reader
  → Resume via ReadingState
```

### 5.2 Learner (MVP)

```text
发现 → choose ReadingWork → 加入书架 (ReadingState)
  → Reader (current ReadingPart)
  → Assist / translate / TTS on this part
  → Keep reading
```

No practice or review step.

### 5.3 User import (Phase 1b — not MVP)

```text
User chooses EPUB/PDF/…
  → Clean + chapter structure
  → ReadingWork (owner = user, visibility = private)
  → Open at last ReadingState
```

Parse failures must be explicit. Do not LLM-“simplify” the book.

### 5.4 Internal — admin_text (dev only)

```text
Operator paste title + body (admin_text)
  → 1 ReadingWork + 1 ReadingPart (kind=body)
  → Publish (optional, for test catalog)
```

Not the product supply story. Not Short Article Library.

### 5.5 What we do not run

```text
Crawl the web → auto-AI “course” → ship to users
LLM rewrites this novel into units with quizzes
AI-generated article library as main shelf filler
```

---

## 6. Quality bar

A catalog work is publishable only if:

1. A reader might **want to keep reading it**
2. Source/rights are clear (structured `sources` channel, licensed EPUB)
3. It does not push Gloaming toward **course pack**, **vocab deck**, **chatbot**, or **AI-generated library**

---

## 7. Phase note

| When           | Content work                                                  |
| -------------- | ------------------------------------------------------------- |
| MVP (Phase 1a) | Admin EPUB pipeline + ReadingWork reader + companion on parts |
| Phase 1b       | User import; `用户` source label in My Library                |
| Phase 2+       | More sources via `origin_kind` — same Work/Part model         |

Empty reader is a failure mode. Filling it with generated articles is a worse failure mode.

---

## 8. Revision log

| Date       | Change                                                                          |
| ---------- | ------------------------------------------------------------------------------- |
| 2026-08-24 | ReadingWork domain; admin EPUB primary; admin_text internal; ADR-001 alignment. |
| 2026-08-20 | Real content pipeline wording; 1a/1b split.                                     |
| 2026-08-05 | Initial curated lean library SSOT (superseded).                                 |
