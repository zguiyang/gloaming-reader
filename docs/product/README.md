# Product docs index

English is the **single language** for product and engineering documentation in this repo (conversation with humans may still be Chinese).

## Find a doc by task

| Task you are doing                                     | Doc                                                                                                                              |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Find an entity, table, or API name                     | [`engineering-vocabulary.md`](./engineering-vocabulary.md) + [ADR-001](../adr/001-reading-content-domain-model.md) (domain SSOT) |
| Decide what content enters Gloaming and how            | [`content-strategy.md`](./content-strategy.md)                                                                                   |
| Check V1 must / must-not                               | [`mvp-scope.md`](./mvp-scope.md)                                                                                                 |
| Wire a screen, route, or return path                   | [`prototype-flows.md`](./prototype-flows.md)                                                                                     |
| Know what is next / still open                         | [`roadmap.md`](./roadmap.md)                                                                                                     |
| Positioning, personas, what Gloaming is NOT            | [`product-vision.md`](./product-vision.md)                                                                                       |
| Judge a product principle in review                    | [`product-principles.md`](./product-principles.md)                                                                               |
| Work on personal tags (CRUD, translation, scope)       | [`personal-tags.md`](./personal-tags.md)                                                                                         |
| Work on public categories (admin CRUD, classification) | [`public-categories.md`](./public-categories.md)                                                                                 |
| Understand why authentic reading                       | [`learning-philosophy.md`](./learning-philosophy.md)                                                                             |
| Choose a metric                                        | [`success-metrics.md`](./success-metrics.md)                                                                                     |
| Decide whether to build a feature                      | [`feature-decision-guide.md`](./feature-decision-guide.md)                                                                       |
| Pre-merge design walkthrough                           | [`design-guardrails.md`](./design-guardrails.md)                                                                                 |

## Surfaces

Users: **Library, Discover, Reader, History, Settings, Account**. Admin: **instance operations, public classifications, provider, storage, jobs**. Navigation and journeys: [`prototype-flows.md`](./prototype-flows.md). Visual tokens: [`DESIGN.md`](../../DESIGN.md).

## One-liner (SSOT)

> Gloaming is an **AI Native Language Reading Environment**. It helps people read authentic English the way they use a modern ebook reader, with contextual AI help when meaning breaks down. Not a course, not drills, not a chatbot. The core is helping people keep reading English they actually want to read.

North star: **effective reading minutes** of authentic English.

Content is modeled as **ReadingWork** (+ **ReadingPart**) — not legacy **Article**. See ADR-001.

Any README, rule, or marketing blurb should match this — not invent a parallel identity.
