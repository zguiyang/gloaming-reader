# Gloaming Content Strategy

SSOT for **what people read** and **how it enters Gloaming**—under the AI Native Language Reading Environment bet.

Related: [`mvp-scope.md`](./mvp-scope.md) · [`mvp-1-modules.md`](./mvp-1-modules.md) · [`engineering-vocabulary.md`](./engineering-vocabulary.md) · ADR-001 [`../adr/001-reading-content-domain-model.md`](../adr/001-reading-content-domain-model.md)

**Language:** Product docs are English. User-facing copy may be Chinese.

---

## 1. Purpose of content

Content exists so someone can **read real English**.

Gloaming is not a corpus-building project, not a course publisher, and not an AI writing mill.

**Personal supply:** users bring their own files through Personal Upload → **我的书架**.

**Catalog supply:** existing published Catalog Works continue through **发现** → **我的书架**. New Catalog intake is deferred to a separately decided Source ingestion policy; Admin is not a content-management surface.
**Never:** generated “learning English” articles as the product. Gloaming does not manufacture learning materials.

---

## 2. Scope decisions (locked)

| Decision                       | Stance                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Personal supply                | User EPUB upload → private owned `ReadingWork` + `ReadingPart[]` → User Library                            |
| Catalog supply                 | Existing published Catalog Works remain available in **发现**; new intake awaits Source ingestion policy   |
| Real content pipeline (EPUB)   | Shared User upload and EPUB parsing; organize chapters and present like a book; do **not** rewrite lessons |
| Official catalog               | Existing team-owned or licensed works continue to feed **发现**                                            |
| `admin_text` fallback          | **Internal only** — dev/test/seed; see §2.1; **not** Short Article Library                                 |
| Scraping / crawl               | **Out**                                                                                                    |
| AI rewrite into graded lessons | **Out** — content generator                                                                                |
| AI at read time                | Explain / translate / TTS on **this part** of **this work**                                                |
| Memes / syllabus trees         | **Out** of identity                                                                                        |
| User-generated marketplace     | **Out** of MVP 1                                                                                           |

Module SSOT: [`mvp-1-modules.md`](./mvp-1-modules.md).

### 2.1 `admin_text` (internal fallback — not product)

`admin_text` is retained as historical provenance and may be used by development/test fixtures to create **ReadingWork + one ReadingPart (`kind=body`)**. There is no Admin runtime or operator paste flow. Use only for:

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

### 5.1 Personal upload

```text
User uploads EPUB
  → private ReadingWork (processing)
  → Parse → ReadingPart[] (chapters)
  → ContentAsset (origin_file)
  → User Library → Reader
  → Resume via ReadingState
```

Catalog Works already published remain discoverable through `published_at`. This task does not add a replacement Catalog intake; future Source ingestion policy requires a separate decision.

### 5.2 Learner (MVP)

```text
发现 → choose ReadingWork → 加入书架 (ReadingState)
  → Reader (current ReadingPart)
  → Assist / translate / TTS on this part
  → Keep reading
```

No practice or review step.

### 5.3 User import

```text
User chooses EPUB/PDF/…
  → Clean + chapter structure
  → ReadingWork (owner = user, visibility = private)
  → Open at last ReadingState
```

Parse failures must be explicit. Do not LLM-“simplify” the book.

### 5.4 Internal fixture — admin_text (dev/test only)

```text
Development/test fixture (admin_text)
  → 1 ReadingWork + 1 ReadingPart (kind=body)
```

This is not an Admin product capability or a Catalog intake path. It is not the Short Article Library.

### 5.5 What we do not run

```text
Crawl the web → auto-AI “course” → ship to users
LLM rewrites this novel into units with quizzes
AI-generated article library as main shelf filler
```

---

## 6. Quality bar

Future Source ingestion should add Catalog Works only when:

1. A reader might **want to keep reading it**
2. Source/rights are clear (structured `sources` channel, licensed EPUB)
3. It does not push Gloaming toward **course pack**, **vocab deck**, **chatbot**, or **AI-generated library**

---

## 7. Phase note

| When    | Content work                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------- |
| Current | User Personal Upload + ReadingWork reader + companion on parts; existing Catalog remains readable |
| Future  | Catalog Source ingestion policy and additional sources via `origin_kind` — same Work/Part model   |

Empty reader is a failure mode. Filling it with generated articles is a worse failure mode.

---

## 8. Revision log

| Date       | Change                                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-24 | Historical baseline: ReadingWork domain; admin EPUB primary; admin_text internal; ADR-001 alignment.                               |
| 2026-09-30 | AS-02 removed Admin Works CMS; preserved existing Catalog Works and Personal Upload; deferred new Catalog intake to Source policy. |
| 2026-08-20 | Real content pipeline wording; 1a/1b split.                                                                                        |
| 2026-08-05 | Initial curated lean library SSOT (superseded).                                                                                    |
