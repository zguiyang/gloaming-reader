# Gloaming Feature Decision Guide

Use this when **planning or reviewing features**.  
Goal: keep every feature serving **reading authentic English**—not quietly becoming Duolingo, LingQ, Anki, a chatbot, or a content factory.

Related: [`product-vision.md`](./product-vision.md) · [`product-principles.md`](./product-principles.md) · [`design-guardrails.md`](./design-guardrails.md) · [`mvp-scope.md`](./mvp-scope.md)

---

## 1. Problem we solve

Users can already find courses, drills, and chatbots. They still cannot **comfortably read real English**.

**Success is not feature count.** Success is whether they willingly **open a text and keep going**.

---

## 2. Four questions (required before build)

### Q1. Does this help the user find, resume, or keep reading authentic content?

- Pass → consider
- If it creates another study task → **refuse**
- Fail otherwise → default no (unless critical safety/infra)

### Q2. Does it lower the cost of being stuck—without replacing reading?

- Pass → companion
- Shame, quizzes-as-gate, “summarize instead of read” as default → drift

### Q3. Does it avoid the forbidden identities?

Not: Duolingo, LingQ, Anki, ChatGPT reading plugin, AI content factory, course platform, practice system.

If users can “have a productive day in Gloaming” with **almost no reading** → danger.

### Q4. Where does it sit on the only loop?

```text
Choose authentic English → Read → Contextual help if stuck → Keep reading
```

If you cannot place it, it is a side quest. Side quests are out of V1.

---

## 3. Feature types and default stance

| Type                   | Examples                               | Default            | Design note                                                    |
| ---------------------- | -------------------------------------- | ------------------ | -------------------------------------------------------------- |
| Main-loop strength     | Import, EPUB parse, typography, resume | **Prioritize**     | This _is_ V1                                                   |
| Comprehension assist   | Inline explain, translation, TTS       | **Yes**            | On demand; do not hijack                                       |
| Personal organization  | Private tags and localized names       | **MVP required**   | Organize the user's Library; automatic tagging requires opt-in |
| Public classification  | Instance categories for discovery      | **MVP scope**      | Separate from private tags; do not imply runtime acceptance    |
| Highlights / bookmarks | Save a line in the book                | **Later**          | Easy to become a vocab inbox                                   |
| Post-input quizzes     | Practice                               | **No for V1**      | Removed from codebase                                          |
| Daily review queue     | Review / SRS                           | **No for V1**      | Removed from codebase                                          |
| Growth dashboard       | Heatmaps, portraits                    | **Keep; optimize** | Reading-history overview                                       |
| Social competition     | Leaderboards                           | **Default no**     |                                                                |
| Courseification        | Syllabus, pass walls                   | **Default no**     |                                                                |
| Free AI chat as home   | Chat without text                      | **Default no**     |                                                                |
| AI-written library     | Generated stories                      | **Default no**     |                                                                |

---

## 4. Review template (copy/paste)

```text
Feature name:
User scenario (who, what frustration):
Loop stage (import / read / unstick / resume):
How it increases authentic reading time / lowers stuck-cost:
Without it, what gets worse:
Drift risks (Duolingo / LingQ / Anki / chat / generate / course):
Success metrics (prefer reading minutes / resume):
Explicit non-goals:
```

Be careful with AI turn count (high turns may mean reading was stolen).

---

## 5. Adding AI without drifting

The purpose of reading assistance and organization AI:

> **Lower friction to stay inside real content.**

| Legal                                                        | Illegal                                          |
| ------------------------------------------------------------ | ------------------------------------------------ |
| Explain words/sentences in this text                         | Default path that skips reading via summary      |
| Translate this sentence / passage                            | Free chat as the home screen                     |
| TTS for this text                                            | Marketing “smarter models” instead of the reader |
| Opt-in personal tag organization and name translation        | Overwrite the user's manual organization         |
| Instance public classification for finding authentic content | Turn classification into generated lessons       |

EPUB parsing into ReadingParts is content infrastructure, not an AI lesson-generation feature. Provider and ownership boundaries for organization are defined in [Personal tags](./personal-tags.md) and [Public categories](./public-categories.md).

Extra check: **If AI is off, does reading still work?** If no, redesign.

---

## 6. Priority heuristic

1. Make it possible to **bring and open** a real text
2. Make it easier to **stay on the page** (reader + assist + translate + TTS)
3. Make **resume** obvious
4. Everything else waits for [`roadmap.md`](./roadmap.md) Phase 2+ **outcomes**, not a feature dump

When stuck on **how** a reader control should feel, study Apple Books, TextStack, and Readest first ([`product-vision.md`](./product-vision.md) §8). Their existence is not a pass on Q1–Q4 or V1 non-goals.

“We already built Practice” is not a reason to keep building Practice.

---

## 7. Philosophy → design cheat sheet

| Belief                                     | Design implication                             |
| ------------------------------------------ | ---------------------------------------------- |
| Language grows from understanding messages | Home is the book, not a quiz bank              |
| Authentic + chosen                         | User import (1b) > catalog of **ReadingWorks** |
| Help on the page                           | i+1 via assist, not only via baby text         |
| Input before output                        | No speaking/practice identity in V1            |
| Tools reduce friction                      | Lookup/translate fast, accurate, dismissible   |

---

## 8. Exceptions

Allowed only if all are true:

1. Clear user harm (crash, privacy, cannot open a file)
2. Marked **temporary** with an exit condition
3. Does not rewrite the reading-loop narrative

Exception without exit = permanent drift.

---

## 9. One-line reset

> **Does this help the user keep reading this page?**

If it creates another study task, stop.
