# Gloaming Content Strategy

SSOT for **what people read** and **how it enters Gloaming** — under the AI Native Language Reading Environment bet.

Related: [`mvp-scope.md`](./mvp-scope.md) · [`engineering-vocabulary.md`](./engineering-vocabulary.md) · [`personal-tags.md`](./personal-tags.md) · [`public-categories.md`](./public-categories.md) · ADR-001 [`../adr/001-reading-content-domain-model.md`](../adr/001-reading-content-domain-model.md)

**Language:** Product docs are English. User-facing copy may be Chinese.

---

## 1. Purpose of content

Content exists so someone can **read real English**. Gloaming is not a corpus-building project, a course publisher, or an AI writing mill.

- **Personal supply:** users upload their own EPUB; the work is **user-owned and private**.
- **Catalog/source supply:** local source metadata and demand-driven import, as defined in section 3.
- **Never:** generated “learning English” articles as the product.

---

## 2. Scope decisions (locked)

| Decision                       | Stance                                                              |
| ------------------------------ | ------------------------------------------------------------------- |
| Personal supply                | User EPUB → private owned `ReadingWork` + `ReadingPart[]` → Library |
| Unit                           | **ReadingWork** (+ **ReadingPart**) — not a lesson                  |
| Real content pipeline          | Shared EPUB parsing; organize chapters; do **not** rewrite lessons  |
| Scraping user pages            | **Out**                                                             |
| AI rewrite into graded lessons | **Out**                                                             |
| AI at read time                | Explain / translate / TTS on **this part** of **this work**         |
| Catalog test fixture           | Neutral ownerless Work; no source identity inferred                 |
| Short Article Library          | **Out** — superseded by ReadingWork                                 |

Reading atom: a **ReadingWork** the user is in the middle of — no 300-word units, no word cap. Difficulty is handled by **help on the page**.

---

## 3. Source intake (accepted: Hybrid — DS01)

This accepted supply direction supersedes the earlier deferral of new Catalog intake. It does not claim complete runtime acceptance.

- **Hybrid:** sync source **metadata locally** into **SourceRecord**; **materialize the EPUB only on save/read intent**. V1 source: Project Gutenberg only.
- **SourceRecord** = local bibliography (source + `externalID`, title/author/language/rights/URL). It is **not readable content**; only a materialized Work enters the Library/Reader.
- **Pending save intent:** save creates a pending intent; on successful import it becomes a **formal membership** (`user_library_item`). Failure keeps a **retryable** state — never fake readiness.
- **Disabled sources** are hidden; a **failed sync retains the last full snapshot**.
- V1 synchronizes the official Gutenberg RDF metadata snapshot **only when an administrator manually triggers it**; automatic/periodic scheduling is deferred. Recovering a lost run (a timed-out or stale `queued`/`syncing` claim) records a visible failure but never starts a new run — only an explicit administrator trigger does. Only a successfully completed snapshot can mark missing records unavailable; no hosted third-party catalog is a runtime requirement.
- **Withdrawal never deletes** an existing work or its progress.
- **Source metadata updates do not overwrite** already-imported parts.
- Import retains source metadata and rights evidence; AI description enrichment must not replace authoritative source fields. Raw subjects and bookshelves remain distinct from public categories.
- **No cross-source semantic dedup:** identity is `(source, externalID)`; identical bytes may be reused, but the same work is not inferred across sources.

New sources, content replacement, and cross-source identity merging require separate decisions. Do not turn a private uploaded EPUB into a public source record merely from its filename.

---

## 4. Domain contract (ADR-001)

| Entity              | Responsibility                                                 |
| ------------------- | -------------------------------------------------------------- |
| **ReadingWork**     | Title, description, language, stats, publication — **no body** |
| **ReadingPart**     | Ordered text — Reader / TTS / Translate / Assist boundary      |
| **ReadingState**    | Per user × work progress only; never membership                |
| **UserLibraryItem** | Explicit catalog membership; membership ≠ progress             |
| **SourceRecord**    | Local source bibliography; not readable                        |
| **ContentAsset**    | EPUB file, cover, TTS audio                                    |
| **Conversation**    | Thread scoped to `reading_work`                                |

**Library** = owned personal works ∪ explicit saved membership. Saving does not start progress; removing membership retains progress. Forbidden on Work: `level`, `seriesId`, single `body` blob.

---

## 5. End-to-end flows

### 5.1 Personal upload

```text
User uploads EPUB → private ReadingWork (processing)
  → Parse → ReadingPart[] → ContentAsset (origin_file)
  → Library → Reader → Resume via ReadingState
```

Parse failures must be explicit. Do not LLM-“simplify” the book.

### 5.2 Source save (Hybrid)

```text
Discover SourceRecord → Save intent (pending)
  → EPUB materialize → ready Work → formal membership
  → Reader → ReadingState on first read
Failure → retryable intent (no fake readiness)
```

### 5.3 What we do not run

```text
Crawl the web → auto-AI “course” → ship to users
LLM rewrites this novel into units with quizzes
AI-generated article library as main shelf filler
```

---

## 6. Quality bar

Add content only when a reader might **want to keep reading it**, provenance/rights are clear, and it does not push Gloaming toward **course pack**, **vocab deck**, **chatbot**, or **AI-generated library**.

Empty reader is a failure mode. Filling it with generated articles is a worse failure mode.
