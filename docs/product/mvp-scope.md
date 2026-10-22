# Gloaming V1 Feature Specification

V1 has one job: **be an excellent AI native language reading environment.**

Related: [`product-vision.md`](./product-vision.md) · [`product-principles.md`](./product-principles.md) · [`roadmap.md`](./roadmap.md) · [`content-strategy.md`](./content-strategy.md) · ADR-001 [`../adr/001-reading-content-domain-model.md`](../adr/001-reading-content-domain-model.md)

This document is the **capability** target (must / must-not).

---

## 1. V1 definition

**V1 success:** A signed-in user can:

1. **Discover** authentic English from the catalog and save what they want (**ReadingWork**)
2. **Read** in a calm, book-like surface (resume via **ReadingState** on the current **ReadingPart**)
3. **Unstick** with on-demand, **passage-grounded** AI
4. **Translate** a sentence or passage when needed
5. **Listen** to the current part with on-demand segmented TTS (starts at the current segment, prefetches ahead, degrades gracefully)
6. **Organize** their Library with personal tags (CRUD + name translation) and browse admin-defined public categories
7. **Keep reading** — no quiz, no review homework, no streak to protect

Returning users land on **continue the unfinished book**, not a study dashboard. **North star:** effective reading minutes of authentic English.

---

## 2. Surfaces

User: **Library, Discover, Reader, History, Settings, Account**. Admin: **instance operations, public classifications, provider, storage, jobs** — operations only, no content authoring. Shared: Work detail `/works/[id]` → Read `/read/[id]` (see [`prototype-flows.md`](./prototype-flows.md)).

---

## 3. Must include

| Capability         | Notes                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Auth session       | Better Auth cookie session; first-party session via Next `/api` proxy                                               |
| Library            | Owned personal works ∪ explicit saved catalog membership (`UserLibraryItem`)                                        |
| Discover           | Browse catalog; explicit save creates membership, not progress                                                      |
| Reading experience | Typography; part navigation; resume part + anchor via **ReadingState**                                              |
| AI reading assist  | Selection → explain in **this passage**; thread scoped to `reading_work`                                            |
| Translation        | Sentence or passage; bilingual view never replaces English as default                                               |
| TTS                | On-demand segmented TTS for the current part — starts at the current segment, prefetches ahead, degrades gracefully |
| Personal tags      | Per-user tag CRUD, localized name translation, assignment (see [`personal-tags.md`](./personal-tags.md))            |
| Public categories  | Admin CRUD + user browse (see [`public-categories.md`](./public-categories.md))                                     |
| Personal EPUB      | User-owned, private; shared parser → private Work (see [`content-strategy.md`](./content-strategy.md))              |

---

## 4. Must not include (V1)

| Out of V1                          | Why                       |
| ---------------------------------- | ------------------------- |
| Lesson / course / practice loop    | Course identity — removed |
| Gamification / XP / streaks        | Duolingo                  |
| SRS / daily cards / forced review  | Anki                      |
| Word-count / vocab decks as center | LingQ                     |
| Chat as home                       | ChatGPT reading plugin    |
| Quota monetization                 | Not in V1                 |
| New orchestration systems          | Out of scope              |
| AI-generated article library       | Content factory           |
| Short Article Library identity     | Superseded by ReadingWork |
| Public social feed                 | Distraction from the page |

---

## 5. Domain rules (invariants)

- **ReadingWork + ReadingPart** are the content model; no legacy `Article`.
- **Library** = owned personal works ∪ explicit saved membership (`UserLibraryItem`).
- **ReadingState** carries progress only: **saving does not start progress; removing membership retains progress.**
- **SourceRecord** is a separate local bibliography and is **not readable content**.

---

## 6. Core journey

```text
Discover → Save (UserLibraryItem) → Library → Reader (ReadingPart)
  → Difficulty → AI Assist / Translate / Listen → Keep reading
```

Full navigation SSOT: [`prototype-flows.md`](./prototype-flows.md). There is no required Practice or Review step.

---

## 7. AI and content constraints

- **Reading assist** is scoped to in-text help and translation of the **current part**; no always-on companion chat.
- **Organization AI** is separate from reading assistance: personal automatic tagging requires user opt-in and BYOK; public classification uses instance configuration. See [`personal-tags.md`](./personal-tags.md) and [`public-categories.md`](./public-categories.md).
- Content stance: [`content-strategy.md`](./content-strategy.md) (personal EPUB; accepted source supply direction).
- **Degrade path:** the work still opens and reads if AI or TTS is off.
- Planning aids: [`feature-decision-guide.md`](./feature-decision-guide.md) · [`design-guardrails.md`](./design-guardrails.md) · [`engineering-vocabulary.md`](./engineering-vocabulary.md).
