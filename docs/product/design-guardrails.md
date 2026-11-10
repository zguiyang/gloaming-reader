# Gloaming Design Guardrails

Use during **reviews, prototype walkthroughs, and post-ship retros** to catch drift early.

Related: [`feature-decision-guide.md`](./feature-decision-guide.md) · [`product-vision.md`](./product-vision.md) · [`product-principles.md`](./product-principles.md)

---

## 1. What “drift” means

Drift = a feature may be polished or metric-positive, but no longer serves:

> People read authentic English, with AI only when they get stuck.

Common disguises: “industry standard,” “competitors have it,” “we already built Practice,” “AI must be stronger,” “growth first, philosophy later.”

Standards inform; they do not override the reader bet.

---

## 2. Red lights (any one → pause merge)

### 2.1 Identity rewrite

| Red light                                                | Why                        | Pull back                         |
| -------------------------------------------------------- | -------------------------- | --------------------------------- |
| Home CTA is “Start chat / Start course / Start practice” | Wrong product              | CTA → continue this book          |
| Users “check in” with almost no reading                  | Task replaces input        | Tie the day to opening the reader |
| Empty states push quiz/AI, not import or a text          | Side loop owns the product | Guide to import or resume         |

### 2.2 Forbidden clones

| Red light                                               | Why                                          | Pull back                                   |
| ------------------------------------------------------- | -------------------------------------------- | ------------------------------------------- |
| Lesson tree, XP, shame streak                           | Duolingo                                     | Reader chrome; no game layer in V1          |
| Word-known % as the homepage                            | LingQ                                        | Stats never outrank the page                |
| Daily card quota / SRS                                  | Anki                                         | No review queue in V1                       |
| Chat as default home                                    | ChatGPT reading plugin                       | Assist inside the book                      |
| Kitchen-sink panels / learning-stats home               | Control-panel product                        | Reader chrome; stats never outrank the page |
| Reintroduce **Article** as content SSOT in docs or APIs | Wrong domain — use **ReadingWork** (ADR-001) | Reject; Phase 3 migrates code               |

### 2.3 Pressure / willpower return

| Red light                          | Why              | Pull back                        |
| ---------------------------------- | ---------------- | -------------------------------- |
| Streak shame, public failure       | Affective filter | Ban shame copy                   |
| Hard walls “must quiz to continue” | Dungeon crawl    | Reading continues without drills |

### 2.4 Input shredded

| Red light                                | Why                         | Pull back                          |
| ---------------------------------------- | --------------------------- | ---------------------------------- |
| Memorize N words before unlock reading   | Skill-building over meaning | Help in context                    |
| Book chopped into unrelated micro-drills | Breaks reading              | Do not ship practice as the sequel |
| Word cards only, no passage              | Vocab app                   | Always return to the page          |

### 2.5 AI overreach

| Red light                                    | Why                     | Pull back                               |
| -------------------------------------------- | ----------------------- | --------------------------------------- |
| Chat is the default home                     | Gloaming ≠ chatbot      | AI secondary                            |
| “Summarize so you needn’t read” as main path | Skips understanding     | Optional assist only                    |
| Core path unusable without AI                | Tool became the product | Degraded reading still works            |
| LLM rewrites the import into a course        | Generator               | Parse structure; keep the author’s text |

### 2.6 Output / review too early

| Red light                                           | Why                   | Pull back                                                        |
| --------------------------------------------------- | --------------------- | ---------------------------------------------------------------- |
| Force speak/write/quiz before or instead of reading | Violates reader-first | Hide practice/review from V1 loop                                |
| Practice time dwarfs reading                        | Inverted priorities   | Cut it — practice is must-not ([`mvp-scope.md`](./mvp-scope.md)) |

---

## 3. Yellow lights (allowed with constraints)

| Yellow                                          | Constraint                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Seed library                                    | Must not become “the catalog is the product”                                                     |
| Gist / summary assist                           | Must not be the default first action                                                             |
| Patterns from Apple Books / TextStack / Readest | Reference only; still pass V1 and identity tests ([`product-vision.md`](./product-vision.md) §8) |
| Points / light gamification                     | Not V1; if ever, not the goal                                                                    |
| Exam-themed **texts**                           | Theme ok; product must not become test coach                                                     |
| Push notifications                              | Rare, no guilt                                                                                   |
| Fancy dashboards                                | Not in default nav; never fake ability scores                                                    |

Yellow features need **success metrics + kill metrics** before ship.

---

## 4. Walkthrough checklist

**Identity**

- [ ] First screen reads as a **reader**, not a class, quiz, or chat
- [ ] Tone is companion + book, not efficiency SaaS

**Main loop**

- [ ] User can touch real English within ~30 seconds (seed or resume; import when built)
- [ ] Assist does not forcibly break immersion
- [ ] No required practice/review to “finish” a session

**Pressure**

- [ ] No streak shame or mandatory giant tasks
- [ ] Closing the book is a complete session

**AI**

- [ ] AI is assist, not home hero
- [ ] Reading works with AI off

**Metrics**

- [ ] Success includes reading minutes / resume—not quiz or chat turns

---

## 5. Retro prompts (after ~2 weeks)

1. Did users spend more time **in the book**, or in menus/chat/practice?
2. Was first success “read a page” or “finished a task”?
3. If we deleted the feature, does the reading loop clearly weaken? If not, it may be noise.
4. Any feedback like “this is just another English app”? Fix identity first.

---

## 6. Competitor temptation table

| They ship                                  | Our first reaction                 |
| ------------------------------------------ | ---------------------------------- |
| Duolingo trees / streaks                   | No                                 |
| LingQ word tracking as core                | Lookup yes; tracking as product no |
| Anki / SRS                                 | No for V1                          |
| Learning statistics as home                | No — stats never outrank the page  |
| Kitchen-sink / multi-tool panels           | No                                 |
| AI speaking coach / avatar / video         | No for V1                          |
| AI-generated graded readers as the library | No                                 |
| Full course trees                          | No                                 |

**Different from the three early references.** Apple Books (typography, atmosphere, simple interaction), TextStack (AI-in-book stance, UI tone, content organization), and Readest (ebook engineering, reader implementation) may be **studied** ([`product-vision.md`](./product-vision.md) §8). Do not copy SRS, learning stats, or multi-tool panels.

---

## 7. Final vote

> **Does this help the user keep reading this page?**

If yes, and it does not create another study task → proceed. If it creates another study task → cut.
