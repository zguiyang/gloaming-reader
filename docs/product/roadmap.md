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

| Item                                            | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Personal tags CRUD + localized-name acceptance  | **Accepted** — admin CRUD, localized names, manual association/removal, and tag filtering; see [`personal-tags.md`](./personal-tags.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Tag ↔ work association                          | **Accepted** — component/backend feature tests plus real page acceptance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Real AI auto-tagging                            | **Accepted (bounded real BYOK sample, 2026-10-19)** — opt-in → dispatch → full worker → persistence → `GET /api/library/tags` rendering verified on 1 personal EPUB (run completed, tag "Fables"/寓言); multi-book batch and single-book re-run (deferred) not covered — see [`personal-tags.md`](./personal-tags.md)                                                                                                                                                                                                                                                                                                                                                               |
| Public categories                               | **Removed** — Discover uses source-native OPDS facets; no Gloaming public-category module                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| On-demand Discover (OPDS)                       | Accepted direction (DS01): Gutenberg official OPDS popular/search/facet; Save upserts SourceRecord and materializes EPUB; RDF full sync and public categories removed — see [`content-strategy.md`](./content-strategy.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Personal AI tagging P2 (existing evidence)      | Historical provider run: 8 valid structured outputs; 7 semantic pass; 1 knot-theory fail; Worker E2E was unrun at that time (since run once with the 2026-10-19 bounded sample)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Real BYOK personal tagging acceptance           | **Accepted (bounded real BYOK sample, 2026-10-19)** — 1 EPUB, 2 real calls (classify + translation), run completed, opt-in restored to off after acceptance; multi-user/batch and P2 historical backfill (by design none) not covered                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| UserTTS runtime                                 | **Implemented in branch `feat/lazy-reader-audio`** — lazy on-demand reader audio (per-segment synthesis, lease-guarded, starts at the current segment with prefetch); real Azure synthesis and page acceptance pending                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Public real Worker/AI + Discover/save/read loop | Historical (2026-10): Discover → save → library → detail → read accepted on record 11339 under the old RDF sync model. Current path is on-demand OPDS Discover + Save upsert (DS01); re-acceptance pending.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Missing-locale translation backfill             | **Removed with public categories** — no longer applicable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| R2 hardening items (2026-10-20)                 | **Implemented with automated tests; page acceptance pending the user** — personal AI tag resilience (same-user lock conflict keeps the run `queued` for redispatch instead of terminal `failed`; `processing` stuck >10 min with `attempts < 2` recovered and redispatched; known `errorCode` surfaced in settings via the optional `latestRunErrorCode` DTO field), AI/manual tag provenance badge (`createdBy: 'ai' \| 'manual'`, `content.library.aiTagBadge`), Library cap notice (`isTruncated`, 48-item limit), and server-side save validation rejecting source records with no EPUB candidate (409 `api.errors.library.sourceRecordNoEpubCandidate`, no intent/queue entry) |
| EPUB download candidate coverage                | On-demand OPDS Save resolves EPUB acquisition links at materialize time; historical RDF full-catalog coverage stats are obsolete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

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
