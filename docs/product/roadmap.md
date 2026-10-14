# Gloaming Roadmap

Three phases. **Outcomes only** — do not pre-design future features.

V1 feature specification: [`mvp-scope.md`](./mvp-scope.md). Domain model: ADR-001 [`../adr/001-reading-content-domain-model.md`](../adr/001-reading-content-domain-model.md). Supply policy: [`content-strategy.md`](./content-strategy.md).

---

## Phase 1 — Language reading environment

**Outcome:** Gloaming is a place you open to **continue authentic English**, with contextual AI that unsticks you on the page, then disappears.

```text
Discover (catalog / SourceRecords) → Library → Reader → AI Assist / Translate / Listen
Personal EPUB → private Work ────────┘
```

Capability must / must-not: [`mvp-scope.md`](./mvp-scope.md). Flows: [`prototype-flows.md`](./prototype-flows.md). Do not ask users to practice, review, or chat.

---

## Phase 2 — AI reading companion

**Outcome:** Help inside the book feels like a **companion for this text**, not a generic chatbot parked beside a page. Do not spec Phase 2 surfaces yet.

## Phase 3 — Reading-based language growth

**Outcome:** Growth is visible as **time and depth with real English**, not a study system bolted on. Do not spec SRS, speaking, or dashboards here.

---

## Outstanding (current)

| Item                                            | State                                                                                                                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Personal tags CRUD + localized-name acceptance  | **Next** — see [`personal-tags.md`](./personal-tags.md)                                                                                                               |
| Tag ↔ work association                          | **Separate** task                                                                                                                                                     |
| Real AI auto-tagging                            | **Separate** task                                                                                                                                                     |
| Public categories                               | Admin CRUD accepted in the 2026-10-14 execution reports; real classification and translation remain unverified — see [`public-categories.md`](./public-categories.md) |
| Personal AI tagging P2 (existing)               | 8 valid structured outputs; 7 semantic pass; 1 knot-theory fail; Worker E2E **unrun**                                                                                 |
| UserTTS runtime                                 | **Deferred**                                                                                                                                                          |
| Public real Worker/AI + Discover/save/read loop | **Unverified**                                                                                                                                                        |

## Open questions (explicitly unresolved)

| Question                                                                 | Status                                     |
| ------------------------------------------------------------------------ | ------------------------------------------ |
| Old `0036` inferred membership cleanup (backfilled from state)           | Unresolved                                 |
| Duplicate-upload semantics — byte reuse does **not** imply the same Work | Unresolved                                 |
| Publication withdrawal — existing membership retained                    | Unresolved (retention is current behavior) |
| Content replacement policy                                               | Undecided                                  |

---

## Rules for this document

- Do not add a Phase 4 of “everything competitors ship.”
- Do not turn Phase 2/3 into a backlog of modules.
- A feature that would make Phase 1 a worse reading environment is a cut, not a sneak peek.
