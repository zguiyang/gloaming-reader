# Product flows

**SSOT for “which screen leads where.”** Wire the shipped app against the tables below. Visual tokens: [`DESIGN.md`](../../DESIGN.md).

Related: [`mvp-scope.md`](./mvp-scope.md) · [`engineering-vocabulary.md`](./engineering-vocabulary.md) · ADR-001 [`../adr/001-reading-content-domain-model.md`](../adr/001-reading-content-domain-model.md)

**Confirmed** = product decisions (auth 2026-08-05; reading loop / IA 2026-08-20; Work detail route 2026-10-10). Do not revive Practice or Review screens. Personal EPUB Upload is an ordinary User flow; Admin does not manage catalog content. Supply boundary: [`content-strategy.md`](./content-strategy.md).

**Routes:** `/read/[workId]`, `/discover`, `/works/[workId]`, `/library`, `/reading-history`. Legacy `/discover/[workId]` redirects to Work detail.

---

## 1. Surfaces

| Surface            | Audience   | Role                                                          |
| ------------------ | ---------- | ------------------------------------------------------------- |
| Landing / Sign in  | Logged-out | Story / CTA → auth                                            |
| **Library**        | Logged-in  | Default home: owned ∪ saved works + Continue Reading          |
| **Discover**       | Logged-in  | Catalog browse; explicit save, open Work detail               |
| Work detail        | Logged-in  | `/works/[id]` — title/cover/meta; not a primary home          |
| **Reader**         | Logged-in  | `/read/[id]` — ReadingPart + assist/translate/TTS             |
| **History**        | Logged-in  | Reading-history overview                                      |
| Settings / Account | Logged-in  | Session, provider, profile                                    |
| Admin              | Admin      | Instance ops, public classifications, provider, storage, jobs |

Practice and Review surfaces are **removed**. Reader is reached via content only.

---

## 2. Navigation rules

| Rule                                                                      | Notes                                                     |
| ------------------------------------------------------------------------- | --------------------------------------------------------- |
| Card **title / cover** → Work detail `/works/[id]`                        | Browsing never jumps straight into reading                |
| Explicit **Read** and **Continue Reading** → `/read/[id]`                 | Reading is always an explicit action                      |
| **Safe detail returnTo**: Library / Discover / History / same-work Reader | Invalid or absent detail origins fall back to Library     |
| Library filter = **source AND tag**, reflected in the URL                 | Client-side loaded subset today — **not** full pagination |
| No new search page or grid view promised                                  | Existing filters only                                     |
| After auth, land on Library                                               | Daily home is continue-the-book                           |
| Reading AI / translate / TTS stay inside the reader                       | Tag organization is separate; never a chat home           |

---

## 3. First-time journey

```text
Sign in → Library (empty or few items)
  → Discover → Save (UserLibraryItem) or open detail → Read
  → Reader (current ReadingPart)
  → Language barrier → contextual help / translation / TTS
  → Keep reading
```

Saving an existing published Work creates membership, not progress. Saving an unmaterialized SourceRecord first creates a pending intent; successful import establishes membership. Neither operation starts reading progress.

---

## 4. Daily reading loop

```text
Open Gloaming → Library → Continue Reading → /read/[id]
  → current ReadingPart → AI help when stuck
  → Keep reading → Leave using the Reader's existing back navigation
```

| From        | Entry                    | To                                                          | Status        |
| ----------- | ------------------------ | ----------------------------------------------------------- | ------------- |
| Library     | Continue Reading         | Reader                                                      | **Confirmed** |
| Library     | Cover / title            | Work detail                                                 | **Confirmed** |
| Discover    | Save                     | Library                                                     | **Confirmed** |
| Discover    | Open item                | Work detail                                                 | **Confirmed** |
| Work detail | Read / continue          | Reader                                                      | **Confirmed** |
| History     | Cover / title            | Work detail                                                 | **Confirmed** |
| History     | Explicit read action     | Reader                                                      | **Confirmed** |
| Reader      | View book details        | Work detail                                                 | **Confirmed** |
| Reader      | Lookup / translate / TTS | Stay in reader                                              | **Confirmed** |
| Work detail | Return                   | Safe Library / Discover / History / same-work Reader origin | **Confirmed** |
| Any         | Practice / Review        | —                                                           | **Retired**   |

---

## 5. Confirmed decisions

| #   | Decision                                                                      | When       |
| --- | ----------------------------------------------------------------------------- | ---------- |
| 1   | Landing primary CTA → Sign in                                                 | 2026-08-05 |
| 2   | Sign-up → verify → reading home                                               | 2026-08-05 |
| 3   | Library continue → Reader (current ReadingWork)                               | 2026-08-20 |
| 4   | Default nav → Library + Discover + History                                    | 2026-08-20 |
| 5   | Practice / Review not in the loop                                             | 2026-08-20 |
| 6   | Work detail is shared `/works/[workId]`; legacy Discover detail redirects     | 2026-10-10 |
| 7   | ReadingState status determines detail CTA copy; `in_progress` continues at 0% | 2026-10-10 |

**North star:** effective reading minutes of authentic English — not practice completion, not review queues, not chat turns.
