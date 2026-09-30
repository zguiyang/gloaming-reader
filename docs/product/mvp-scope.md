# Gloaming V1 Feature Specification

V1 has one job: **be an excellent AI native language reading environment.**

Related: [`product-vision.md`](./product-vision.md) · [`product-principles.md`](./product-principles.md) · [`mvp-1-modules.md`](./mvp-1-modules.md) · [`roadmap.md`](./roadmap.md) · [`content-strategy.md`](./content-strategy.md) · ADR-001 [`../adr/001-reading-content-domain-model.md`](../adr/001-reading-content-domain-model.md)

This document is the **capability** target (must / must-not). Module inventory: [`mvp-1-modules.md`](./mvp-1-modules.md). Shipped code vs target: [`feature-audit.md`](./feature-audit.md).

---

## 1. V1 definition

**V1 success:** A signed-in user can:

1. **Discover and open** authentic English from the official catalog (**ReadingWork**)
2. **Read it** in a calm, book-like surface (resume via **ReadingState** on the current **ReadingPart**)
3. **Unstick** with on-demand, **passage-grounded** AI
4. **Translate** when they need the meaning of a sentence or passage
5. **Listen** to the text (TTS on the current part)
6. **Keep reading**—no quiz, no review homework, no streak to protect

Returning users land on **continue the unfinished book**, not a study dashboard.

If they only sign in and see a learning-platform home, V1 has failed.

---

## 2. Must include

| Capability               | Notes                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------- |
| Auth session             | Better Auth cookie session; first-party session via Next `/api` proxy                   |
| Official catalog → shelf | Browse **发现**, add to **我的书架** (creates **ReadingState**)                         |
| **Catalog Works**        | Existing published Works remain discoverable; new intake awaits Source ingestion policy |
| **EPUB processing**      | User Personal Upload → shared parser → private Work; Catalog source intake is deferred  |
| Reading experience       | Typography; chapter/part navigation; resume part + anchor                               |
| AI companion             | Selection → explain in **this passage**; thread on **reading_work**; not chat home      |
| Translation              | Sentence or passage; bilingual view must not replace English as default                 |
| TTS                      | Listen to **current part**; degrade if audio unavailable                                |
| User import              | Personal EPUB Upload through `/api/works`; remains separate from Catalog supply         |

Discover continues to show existing published **ReadingWorks** according to `published_at`. Admin accounts use the same Personal Upload flow as every other user; Catalog intake awaits Source ingestion policy.

---

## 3. Must not include (V1)

| Out of V1                                           | Why                                                        |
| --------------------------------------------------- | ---------------------------------------------------------- |
| Gamification / XP / shame streaks                   | Duolingo                                                   |
| Word-count / vocab-collecting as the center         | LingQ                                                      |
| SRS / daily cards / forced review                   | Anki                                                       |
| Complex review / practice / quiz                    | Second loop                                                |
| **Lesson system / course progression**              | Course app identity                                        |
| **Practice loop**                                   | Removed from codebase                                      |
| Chat as home / chatting as the core                 | ChatGPT reading plugin                                     |
| **AI-generated article library**                    | Content factory                                            |
| **Short Article Library** as product                | Superseded by ReadingWork (ADR-001)                        |
| Speaking training / AI avatar / video chat          | Not a reading environment                                  |
| Public social feed                                  | Distraction from the page                                  |
| Kitchen-sink control panels                         | Study chrome we do not copy                                |
| **User upload** as a primary navigation destination | Upload remains available through the Personal Library flow |

Do not “fill V1” with Phase 2 ideas. See [`roadmap.md`](./roadmap.md).

---

## 4. Core user journeys (product)

Full navigation SSOT: [`prototype-flows.md`](./prototype-flows.md).

### 4.1 Core loop

```text
Discover
  → Choose ReadingWork
  → Add to Shelf (ReadingState)
  → Reader (ReadingPart)
  → Encounter difficulty
  → AI Assist
  → Continue Reading
```

### 4.2 First-time

```text
Sign in
  → 我的书架 (empty or few items)
  → 发现 → 加入书架 (or open)
  → Reader
  → Read
  → Language barrier → contextual help / translation / TTS
  → Keep reading
```

(Personal Upload is available through the User-owned Library flow; it is not a primary navigation destination. Existing Catalog Works remain available, and new intake awaits Source policy.)

### 4.3 Daily

```text
Open Gloaming
  → Resume last unfinished ReadingWork (我的书架)
  → Read current ReadingPart
  → Help when stuck
  → Keep reading
  → Leave
```

There is no required Practice or Review step.

---

## 5. Content stance for V1

**Full SSOT:** [`content-strategy.md`](./content-strategy.md).

| Topic           | Stance                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------ |
| Catalog supply  | Existing published **ReadingWork** via **发现**; new intake awaits Source ingestion policy |
| Personal Upload | User EPUB → private owned Work in Library                                                  |
| Unit            | **ReadingWork** (+ **ReadingPart** for text) — not a lesson                                |
| Catalog fixture | Neutral ownerless Catalog Work used in tests; no source identity is inferred               |
| Scraping        | Out                                                                                        |

---

## 6. AI / privacy / cost (V1 constraints)

- AI only for **in-text** assistance and translation of the **current part** (help thread scoped to **reading_work** if it exists)
- **Degrade path:** the work still opens and reads if AI or TTS is off
- Do not send more context than needed; no always-on companion chat
- Cost: short prompts tied to selection / sentence / **current part**—not whole-library RAG theater
- EPUB parsing is infrastructure, not “generate English”

---

## 7. How to use this doc in planning

1. Confirm the work is **in** V1 (§2) and not in §3
2. Answer: _Does this help the user keep reading this page?_ If it creates a study task → stop
3. Run [`feature-decision-guide.md`](./feature-decision-guide.md)
4. Walk [`design-guardrails.md`](./design-guardrails.md) before merge
5. Domain names: [`engineering-vocabulary.md`](./engineering-vocabulary.md)

---

## Revision log

| Date       | Change                                                                                |
| ---------- | ------------------------------------------------------------------------------------- |
| 2026-08-24 | ReadingWork loop; admin EPUB must; lesson/practice/article library must-not; ADR-001. |
