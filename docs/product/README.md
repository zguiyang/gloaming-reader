# Product docs index

English is the **single language** for product and engineering documentation in this repo (conversation with humans may still be Chinese).

## Read in this order

| Order | Doc                                                                                 | When to use                                                       |
| ----- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 0     | [ADR-001: Reading Content Domain Model](../adr/001-reading-content-domain-model.md) | **Domain SSOT** — entities, migration boundary                    |
| 1     | [`engineering-vocabulary.md`](./engineering-vocabulary.md)                          | Product vs engineering naming; target APIs                        |
| 2     | [`content-strategy.md`](./content-strategy.md)                                      | Personal uploads; Catalog supply direction; `admin_text` internal |
| 3     | [`product-vision.md`](./product-vision.md)                                          | Positioning, personas, what Gloaming is NOT                       |
| 4     | [`product-principles.md`](./product-principles.md)                                  | Reading first, real content, AI companion                         |
| 5     | [`mvp-scope.md`](./mvp-scope.md)                                                    | **V1 capability** must / must-not                                 |
| 6     | [`mvp-1-modules.md`](./mvp-1-modules.md)                                            | **MVP 1 module roadmap** (Phase 1a)                               |
| 7     | [`roadmap.md`](./roadmap.md)                                                        | Phase 1–3 outcomes; 1a vs 1b                                      |
| 8     | [`feature-audit.md`](./feature-audit.md)                                            | Code vs target; Phase 3 migration plan                            |
| 9     | [`prototype-flows.md`](./prototype-flows.md)                                        | First-time + daily reading loop; nav SSOT                         |
| 10    | [`learning-philosophy.md`](./learning-philosophy.md)                                | Why authentic reading (research)                                  |
| 11    | [`success-metrics.md`](./success-metrics.md)                                        | North star: engaged reading minutes                               |
| 12    | [`feature-decision-guide.md`](./feature-decision-guide.md)                          | Before building a feature                                         |
| 13    | [`design-guardrails.md`](./design-guardrails.md)                                    | Reviews, walkthroughs, retros                                     |

**Archived (do not use as V1 scope):** [`docs/archive/feature-short-article-library-v1.md`](../archive/feature-short-article-library-v1.md)

## Screen flows

Navigation and journeys: [`prototype-flows.md`](./prototype-flows.md). Visual tokens: [`DESIGN.md`](../../DESIGN.md).

## One-liner (SSOT)

> Gloaming is an **AI Native Language Reading Environment**. It helps people read authentic English the way they use a modern ebook reader, with contextual AI help when meaning breaks down. Not a course, not drills, not a chatbot. The core is helping people keep reading English they actually want to read.

Content is modeled as **ReadingWork** (+ **ReadingPart**) — not legacy **Article**. See ADR-001.

Any README, rule, or marketing blurb should match this—not invent a parallel identity.

## Revision log

| Date       | Change                                                             |
| ---------- | ------------------------------------------------------------------ |
| 2026-08-24 | ADR-001 first in read order; ReadingWork vocabulary; archive path. |
