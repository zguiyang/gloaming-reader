# Gloaming Learning Philosophy

Canonical reference for **why Gloaming is a reading environment**: beliefs, scholarly lineage, critiques we accept, and how beliefs map to product surfaces.

Companion to [`product-vision.md`](./product-vision.md) (identity) and [`product-principles.md`](./product-principles.md) (decision rules).

Day-to-day: [`feature-decision-guide.md`](./feature-decision-guide.md) · [`design-guardrails.md`](./design-guardrails.md).

Index: [`README.md`](./README.md)

**Language:** Product and engineering docs in this repo are **English**. User-facing UI copy may be Chinese.

---

## 1. One-sentence stance

Gloaming believes people build durable English mainly by **reading (and hearing) authentic messages they care about**, with help that keeps most of the page understandable—not by completing courses, drills, or chat sessions.

AI exists to **keep the reader in the book**, not to replace the book.

---

## 2. Where this stance came from

### 2.1 Practitioner / community lineage

| Source                                | Role for Gloaming                                                                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **罗肖尼 Shawney**                    | Fluency from massive interesting input; do not force early output                                                                                         |
| **Steve Kaufmann**                    | Time with compelling authentic content; lookup is legitimate if it helps you consume more                                                                 |
| **Apple Books / TextStack / Readest** | Early **UI and interaction** references only — see [`product-vision.md`](./product-vision.md) §8. Not a license to clone SRS or their full feature lists. |

These pointed us at a research tradition. They are not a license to clone LingQ, Duolingo, or Anki.

### 2.2 What Gloaming is _not_ claiming

- We are **not** claiming Krashen is uncontested or that input alone explains all of SLA.
- We are **not** building a “never look anything up” ideology product.
- We **are** claiming that for our users, a **reading-first, authentic-content, low-anxiety** product is the right bet—and it is supported enough by SLA and extensive-reading research to build around.

V1 does **not** need output practice or spaced review to honor this stance. Those are easy ways to drift into a study app.

---

## 3. Core beliefs (product language)

| #   | Belief                                                                                          | Anti-pattern we reject                                                     |
| --- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | Language grows when you **understand messages**                                                 | Grammar/vocab drills as the main path                                      |
| 2   | Content must be **authentic and chosen**                                                        | A curriculum nobody asked to finish                                        |
| 3   | Difficulty is handled by **help on the page**, not by replacing the book with a graded pamphlet | Either crushing native text with no help, or only shipping 200-word fables |
| 4   | **Volume over time** beats heroic study plans                                                   | Daily quests, XP, shame streaks                                            |
| 5   | **Input first**                                                                                 | Forced speaking / chatbot-as-product                                       |
| 6   | Tools reduce **friction to keep reading**                                                       | Tools that replace reading with quizzes, cards, or generated lessons       |

Re-meeting words in **later reading** is how vocabulary actually sticks. That does **not** require an Anki module in V1.

---

## 4. Scholarly pillars (why a reader)

### 4.1 Comprehensible / optimal input — Stephen Krashen

**Claim (simplified):** Acquisition happens when learners understand input slightly beyond current competence. Fluency is largely a **result** of that input.

**Optimal Input (2020):** comprehensible, **compelling**, rich, **abundant**.

**How Gloaming uses it:** The reader is the product. AI/translation/TTS raise the share of the page you can understand **without turning the page into a worksheet**.

Pointers: Krashen, _Principles and Practice in Second Language Acquisition_; _The Power of Reading_ (2004); “Optimal Input,” _Language Magazine_ (2020).

### 4.2 Contemporary reassessment — Lichtman & VanPatten (2021)

Core input ideas persist under modern labels (implicit learning, ordered development, communicatively embedded input).

**How Gloaming uses it:** Reading-first is a living research direction, not a 1980s slogan. We still read critiques (§5).

### 4.3 Free voluntary / extensive reading — Day, Bamford, Krashen, Renandya

Large amounts of **self-selected** reading for pleasure/general understanding improve reading and often transfer. Day & Bamford: easy-enough material, learner choice, volume, pleasure purpose, reading as its own reward.

**How Gloaming uses it:** Import + choice. A seed shelf is a courtesy, not a syllabus. Session design = **wanting to continue the book**.

Pointers: Day & Bamford (1998, 2002); ER Foundation bibliography.

### 4.4 “Book flood” — Elley & Mangubhai (1983)

Abundant high-interest books accelerated L2 English reading/listening in a classic field study.

**How Gloaming uses it:** More readable authentic pages → growth. The product should increase **pages of real English**, not exercises completed.

### 4.5 Vocabulary from reading — Paul Nation

Incidental vocabulary learning is real but **fragile**—needs repeated meetings in meaning-focused input. Comfortable reading often needs very high known-token coverage; help (gloss, translation) is a way to keep coverage up **in the text you chose**.

**How Gloaming uses it:** Inline lookup and translation are **coverage tools**. They are not a flashcard product. Nation also notes ER is not a complete _curriculum_—Gloaming is not trying to be a complete curriculum.

### 4.6 Affective filter / anxiety

High anxiety blocks usable input. Compelling content and low pressure increase the chance that input becomes intake.

**How Gloaming uses it:** Book-like UX; no streak-shame; closing the reader is a valid end of session.

### 4.7 Output and spacing (honest, deprioritized for V1)

**Swain (output):** Production can push noticing. Valid later—**not** the V1 identity. Do not reintroduce Practice modules as a philosophy requirement.

**Spacing (Ebbinghaus / Cepeda):** Distributed encounters help memory. In a reader, that should mean **meeting language again in books**, not a daily review queue. Review/SRS was removed from the codebase for V1. See [`mvp-scope.md`](./mvp-scope.md).

**Interaction (Long):** Negotiation of meaning is secondary. If it appears, it is clarification **about this page**, not a conversation product.

---

## 5. Honest critiques

| Critique                                         | Gloaming response                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| “Comprehensible input” is hard to operationalize | Proxies: did they keep reading? assist used then returned to the page—not mystical i+1 |
| Input-only underplays attention and output       | V1 still chooses input. We do not pretend drills are required to ship a reader         |
| Incidental vocab is slow                         | Volume + staying in interesting text; not an Anki bolt-on to “fix” science             |
| ER effect sizes vary                             | Obsess over **interest + help + habit of opening the book**                            |

---

## 6. Belief → product map

| Belief                                   | Product surface (V1)                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| Authentic, chosen input                  | Import + shelf; seed texts optional                                              |
| Lower friction without replacing reading | Inline AI, translation, TTS                                                      |
| Stay in the message                      | Reader is home; assist is secondary                                              |
| Low-pressure persistence                 | Resume position; no quiz gate                                                    |
| Growth from volume                       | North star = engaged reading time ([`success-metrics.md`](./success-metrics.md)) |

Surfaces we **do not** map philosophy onto in V1: Practice, Review, Progress-as-scoreboard, chatbot home. Progress as **reading history** (heatmap / volume) is allowed.

---

## 7. How to use this doc

When designing features, copy, or experiments, ask:

1. Does this **increase time reading authentic English**?
2. Does this **reduce the cost of being stuck**?
3. Does this **avoid Duolingo / LingQ / Anki / chatbot / content-factory identity**?
4. If we add AI, does it still **serve the page**—or steal the loop?

If a feature fails these tests, it is off-mission—even if the old Gloaming built it.

---

## 8. Reference shortlist

1. Krashen — Input Hypothesis / _The Power of Reading_ / Optimal Input (2020).
2. Lichtman & VanPatten (2021). Was Krashen right? Forty years later. _Foreign Language Annals_.
3. Day & Bamford (1998, 2002) — extensive reading principles.
4. Elley & Mangubhai (1983). The impact of reading on second language learning.
5. Nation — _Learning Vocabulary in Another Language_; vocabulary via extensive reading.
6. Swain (1985) — output (later, not V1).
7. Cepeda et al. (2006) — spacing (as a caution against fake “memory products,” not a mandate to ship SRS).

Community bridges (non-primary science): Shawney; Kaufmann.

---

## 9. Revision log

| Date       | Change                                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| 2026-08-20 | Reframed for AI Native Language Reading Environment: authentic reading-first; practice/review unmapped from V1. |
| 2026-08-05 | Initial draft from Shawney/Kaufmann + scholarly search.                                                         |
