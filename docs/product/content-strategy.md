# Gloaming Content Strategy

SSOT for **what people read** and **how it enters Gloaming** — under the AI Native Language Reading Environment bet.

Related: [`mvp-scope.md`](./mvp-scope.md) · [`engineering-vocabulary.md`](./engineering-vocabulary.md) · [`personal-tags.md`](./personal-tags.md) · ADR-001 [`../adr/001-reading-content-domain-model.md`](../adr/001-reading-content-domain-model.md)

**Language:** Product docs are English. User-facing copy may be Chinese.

---

## 1. Purpose of content

Content exists so someone can **read real English**. Gloaming is not a corpus-building project, a course publisher, or an AI writing mill.

- **Personal supply:** users upload their own EPUB; the work is **user-owned and private**.
- **Catalog/source supply:** on-demand third-party discovery and import, as defined in section 3.
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
| Public categories              | **Out** — removed; Discover uses source-native facets only          |
| Full third-party catalog sync  | **Out** — not the Discover main path                                |

Reading atom: a **ReadingWork** the user is in the middle of — no 300-word units, no word cap. Difficulty is handled by **help on the page**.

---

## 3. Source intake (accepted: On-demand — DS01)

This accepted supply direction supersedes Hybrid metadata-full-sync. It does not claim complete runtime acceptance until the OPDS Discover path is verified in the target environment.

- **On-demand:** Discover browses and searches the remote source (V1: Project Gutenberg **official OPDS**). Results are ephemeral `DiscoveryCandidate` projections — **not** a local full bibliography.
- Discover surfaces: **popular / default list**, **search**, and **source-native facets** (Gutenberg Category bookshelves). There is no Gloaming public-category module.
- **Persist only on Save:** Add to Library upserts a minimal `SourceRecord` keyed by `(source, externalID)`, creates a pending save intent, downloads the EPUB from OPDS acquisition links, parses into a `ReadingWork`, then creates formal membership (`user_library_item`).
- **SourceRecord** after Save = durable import identity + materialization link. It is **not** a browsable full catalog mirror.
- **Pending save intent:** save creates a pending intent; on successful import it becomes membership. Failure keeps a **retryable** state — never fake readiness. Status via `GET /api/library/source-records/:id`.
- **Disabled sources** are hidden from Discover.
- **Withdrawal never deletes** an existing work or its progress.
- **Source metadata updates do not overwrite** already-imported parts.
- Import retains source metadata and rights evidence. Raw subjects/bookshelves may appear on a candidate or saved record as source metadata only.
- **No cross-source semantic dedup:** identity is `(source, externalID)`.
- **Covers:** unmaterialized candidates use the source cover URL. Materialized records prefer the linked Work's local cover when the viewer may read it; otherwise the source cover URL stays.
- **Forbidden:** Gutenberg RDF full/partial catalog sync as the Discover main path; pre-assigning every remote book into local classification tables.

New sources and user-defined OPDS feeds require separate decisions but share the same adapter contract (`listPopular`, `search`, optional `listByFacet`, `getByExternalId`, `resolveEpubCandidates`). A source without facets remains searchable.

---

## 4. Domain contract (ADR-001)

| Entity              | Responsibility                                                 |
| ------------------- | -------------------------------------------------------------- |
| **ReadingWork**     | Title, description, language, stats, publication — **no body** |
| **ReadingPart**     | Ordered text — Reader / TTS / Translate / Assist boundary      |
| **ReadingState**    | Per user × work progress only; never membership                |
| **UserLibraryItem** | Explicit catalog membership; membership ≠ progress             |
| **SourceRecord**    | Saved/importing source identity; not a full remote catalog     |
| **ContentAsset**    | EPUB file, cover, images                                       |
| **Conversation**    | Thread scoped to `reading_work`                                |

**Library** = owned personal works ∪ explicit saved membership. Saving does not start progress; removing membership retains progress. Forbidden on Work: `level`, `seriesId`, single `body` blob.

---

## 5. End-to-end flows

### 5.1 Personal upload

```text
User uploads EPUB → private ReadingWork (processing)
  → Parse → ReadingPart[] → ContentAsset (origin_file)
  → ready → Library → Reader → Resume via ReadingState
  → (async) OPDS title(+author) match on enabled sources
       → hit: fill empty/weak metadata (description, cover, …); never replace EPUB
       → miss: leave fields empty / OPF as-is
```

Parse failures must be explicit. Do not LLM-“simplify” the book. Do not use AI to invent Work metadata.

### 5.2 Source save (on-demand)

```text
Discover remote candidate (OPDS) → Save
  → Upsert minimal SourceRecord → Save intent (pending)
  → EPUB materialize from acquisition link → ready Work → formal membership
  → Reader → ReadingState on first read
Failure → retryable intent (no fake readiness)
```

### 5.3 What we do not run

```text
Crawl the web → auto-AI “course” → ship to users
LLM rewrites this novel into units with quizzes
AI-generated article library as main shelf filler
AI Work metadata enrichment from book body / TOC excerpts
Full third-party catalog sync into Postgres as Discover prerequisite
Gloaming public-category classification of the remote catalog
```

---

## 6. Quality bar

Add content only when a reader might **want to keep reading it**, provenance/rights are clear, and it does not push Gloaming toward **course pack**, **vocab deck**, **chatbot**, or **AI-generated library**.

Empty reader is a failure mode. Filling it with generated articles is a worse failure mode.
