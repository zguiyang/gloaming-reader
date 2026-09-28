# User-first Architecture Review Index

**Review gate:** 01 — PR-01 through PR-05
**Audit baseline:** `origin/dev` at `4efa89a9944561ad4f57b37d57f115fd78f7f43f`
**Review head:** PR-05 checkpoint `dd60b348a482268f126a2de936941a120225f005`
**Review branch:** `codex/user-first-review-gate-01`
**Human review:** Pending for every stage

This directory is the durable evidence trail for the User-first Architecture epic. It records implemented code separately from design intent, test evidence, and unresolved product/data decisions. Plans and ADRs describe intent; Git history, source, schema, routes, and tests establish runtime facts.

## Architecture Baseline

The pre-epic baseline is `origin/dev` at `4efa89a9944561ad4f57b37d57f115fd78f7f43f` (`4efa89a9`). Each stage below is compared with its actual parent commit.

## Stage Index

| Stage | Commit | Base | Primary domain | Implementation status | Human review status | Document |
| --- | --- | --- | --- | --- | --- | --- |
| PR-01 | `a7804424d18d122bc1e1c8ecc1a7cab8eb5729f4` | `4efa89a9944561ad4f57b37d57f115fd78f7f43f` | Schema foundation | Implemented | Pending | [PR-01](pr-01-schema-foundation.md) |
| PR-02 | `a3f2a69dfd0d945aa1d6fce43089f9ae96e5d4b6` | `a7804424d18d122bc1e1c8ecc1a7cab8eb5729f4` | Work read access | Implemented | Pending | [PR-02](pr-02-work-access-policy.md) |
| PR-03 | `dac344508f8f10faa38aed1721e8bab49a3572c3` | `a3f2a69dfd0d945aa1d6fce43089f9ae96e5d4b6` | Publication SSOT | Implemented | Pending | [PR-03](pr-03-publication-ssot.md) |
| PR-04 | `d16ee9ce82e9e5a7015b30b7dee4435dd96b1a04` | `dac344508f8f10faa38aed1721e8bab49a3572c3` | Ingest and Catalog | Implemented | Pending | [PR-04](pr-04-ingest-catalog.md) |
| PR-05 | `dd60b348a482268f126a2de936941a120225f005` | `d16ee9ce82e9e5a7015b30b7dee4435dd96b1a04` | Library domain | Implemented | Pending | [PR-05](pr-05-library-domain.md) |

`Implemented` describes code in the checkpoint range. It does not mean human-approved, merged, published, or fully regression-tested.

## Architecture Timeline

| Stage | Runtime boundary established |
| --- | --- |
| PR-01 | The database and shared contracts can represent User-first processing state, publication time, Library membership rows, and nullable provider ownership. |
| PR-02 | Work reads use ownership-aware access: the owner, an Admin, or a reader of a published Catalog Work. |
| PR-03 | Publication is an idempotent `published_at` transition independent of processing state. |
| PR-04 | Personal and Catalog EPUB ingest use a shared ingest core with distinct ownership, visibility, authentication, and Admin policies. |
| PR-05 | Library membership, reading progress, reading history, and Continue Reading are separate runtime projections. |

## Legacy Evolution

| Legacy concept | Original meaning | Removed / changed in | Replacement | Current runtime status |
| --- | --- | --- | --- | --- |
| `reading_work.status` mixed pipeline and publication | One status represented processing, TTS, and published state | PR-01 | `processing_status` plus `published_at` | Old DB column/runtime field absent. Old `tts` and `published` values migrate to `ready`; negative contract tests mention old values. |
| TTS as Work processing status | `tts` was one Work status | PR-01; PR-04 workflow filter | `workflowStep=tts`, workflow lease metadata, and `ContentAsset` readiness | `processing_status` has no `tts`; TTS remains a workflow step. Catalog publication still requires ready default US audio. |
| Published-only Reader access | Public-content helpers admitted published Works only | PR-02 | `WorkReadActor`, `workReadAccessSql`, and `requireReadable*` | Owners may read their private Work; Admin may read all; non-owners may read published Catalog Works. |
| `requirePublished*` access helpers | Publication was the universal read gate | PR-02 | `requireReadableWorkWithParts` / `requireReadablePart` | No `requirePublished*` helper remains in active backend source. Catalog listing/publication still checks `published_at`. |
| Admin `/works` namespace | Admin Work endpoints/pages were not explicitly Catalog-scoped | PR-04 | `/admin/catalog/works`, `/api/admin/catalog/works` | Old Admin routes have no aliases. Internal `domains/works` and `features/admin/works` names remain. |
| Admin-only EPUB upload | EPUB ingest entered through Admin | PR-04 | Authenticated `POST /api/works` for private Personal Works; Admin Catalog upload stays separate | Backend Personal upload exists; learner upload UI is absent. |
| `reading_state` as Library membership | Opening/reading could mean “saved” | PR-05 runtime; PR-01 backfill remains | `user_library_item` for explicit Catalog saves; ownership for Personal Works; `reading_state` for progress | Future reading does not create membership. Migration 0036 copied every historical state row; human decision remains open. |
| Shelf API/domain | `/api/shelf`, Shared Shelf DTOs, and `features/shelf` represented progress-based membership | PR-05 | `/api/library`, `@gloaming/shared/library`, `features/library` | Old Shelf service/modules are removed. `/my-shelf` remains the Web route and redirect target. |
| TTS-blocking readiness | TTS lived inside Work status | PR-01 | Independent Work processing state and TTS workflow step | Status coupling removed; existing publish gate still requires ready default US audio. |

## Decision Watchlist

`Needs Human Review = Yes` items are not implementation instructions. Current count: **10** (one data decision and nine product decisions).

| ID | PR | Area | Decision | Current behavior | Product/data impact | Status |
| --- | --- | --- | --- | --- | --- | --- |
| PR05-HISTORY-001 | PR-01/05 | Historical data | Decide whether to retain, remove, or selectively recover migration 0036 membership rows | Every old `reading_state` row became `user_library_item`; no provenance distinguishes explicit saves from reads | Library may overstate historical user intent; reliable selective marker not confirmed | Needs Human Product/Data Decision |
| PR04-PRODUCT-001 | PR-04 | Duplicate upload | Define whether the same EPUB uploaded twice creates two Works or one | Object bytes may be reused by hash, but each ingest creates a new Work | Duplicate entries and independent progress | Product Decision Required |
| PR03-PRODUCT-002 | PR-03/05 | Unpublish | Decide what saved membership means while a Catalog Work is unpublished | Membership row remains; Library hides it while publication is absent; republish makes it visible again | Saved intent persists invisibly | Product Decision Required |
| PR05-PRODUCT-003 | PR-05 | Library identity | Confirm “Library” versus retained `/my-shelf` route and any future route migration | Library semantics live at `/my-shelf` | Naming, navigation, links, long-lived URLs | Product Decision Required |
| PR05-PRODUCT-004 | PR-05 | Library grouping | Decide whether owned Personal Works and saved Catalog Works are grouped or unified with source labels | One combined API list; DTO has no explicit membership/source kind | Users may not understand owned vs saved Catalog items | Product Decision Required |
| PR05-PRODUCT-005 | PR-04/05 | Personal upload | Decide where upload lives and how processing/failure appears | Authenticated upload API exists; Library DTO omits `processingStatus` | Work can be created without a surfaced upload/processing lifecycle | Product Decision Required |
| PR05-PRODUCT-006 | PR-05 | Personal deletion | Define whether/how a user deletes an owned Work | No learner delete endpoint; Catalog removal deletes only membership | “Delete Work” and “Remove from Library” semantics unresolved | Product Decision Required |
| PR05-PRODUCT-009 | PR-05 | Historical visibility | Decide whether users should be told some Library items were migrated heuristically | Migrated and explicitly saved rows have the same membership shape | Trust and cleanup expectations | Product Decision Required |
| PR05-PRODUCT-010 | PR-05 | Ordering/capacity | Confirm newest-created/saved ordering and fixed 50-item result limit | Owned rows sort by Work creation; saved rows by membership creation; result is capped | Large Libraries may omit items; ordering is user-visible | Product Decision Required |
| PR05-PRODUCT-011 | PR-04/05 | Admin UX | Revisit Catalog Admin copy and workflow presentation after namespace move | Admin paths are Catalog-scoped; no visual redesign was part of this audit | Operational language and distinction from Personal Works | Product Decision Required |

## Final Acceptance Checklist

- [ ] PR-01 schema reviewed by maintainer
- [ ] PR-02 access policy reviewed by maintainer
- [ ] PR-03 publication reviewed by maintainer
- [ ] PR-04 ingest and Catalog reviewed by maintainer
- [ ] PR-05 Library reviewed by maintainer
- [ ] User-first frontend reviewed
- [ ] Provider resolver reviewed
- [ ] Settings reviewed
- [ ] Historical migration 0036 decision resolved
- [ ] Architecture Subtraction Audit completed
- [ ] Legacy Remaining = 0 verified against runtime and contracts
- [ ] Full regression completed
- [ ] Final E2E completed
