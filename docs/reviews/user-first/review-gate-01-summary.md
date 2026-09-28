# User-first Architecture Review Gate 01 - Summary

Status: PR-01 through PR-05 implemented at their checkpoint commits
Human Review: Pending for every stage
Baseline: origin/dev at 4efa89a9944561ad4f57b37d57f115fd78f7f43f
Review head: dd60b348a482268f126a2de936941a120225f005
Branch: codex/user-first-review-gate-01

This summary consolidates the five stage audits. Stage docs contain the file-by-file paths, named symbols, route/API details and historical verification evidence.

## Current Architecture

The system has a single ReadingWork/ReadingPart content model. Work processing is recorded in processing_status; Catalog publication is published_at. A Work is readable by its owner, an Admin, or a non-owner when it is a published Catalog Work. Personal EPUB ingest creates a private owner Work using the shared ingest core. Admin upload and management are Catalog-scoped. Library is owned Personal Works plus explicitly saved published Catalog Works. ReadingState is optional progress, Reading History is behavior, and Continue Reading is an independent in-progress projection.

This describes current code at PR-05, not completion of the full User-first epic.

## Five Core Domains

| Domain | SSOT | Primary implementation | Current status |
| --- | --- | --- | --- |
| Ownership | reading_work.owner_user_id; user_library_item for explicit saves | PR-01 migration/schema; PR-04 Personal upload; PR-05 Library service | Personal ownership and Catalog save are implemented. Historical backfill intent is unresolved. |
| Access | canReadWorkRow/workReadAccessSql over owner, role, visibility and published_at | apps/backend/src/domains/works/access; consumers in Reader, assets, AI context and history | Implemented for owner, Admin and public Catalog boundaries. |
| Publication | reading_work.published_at; processing_status is separate | apps/backend/src/domains/works/admin/admin-lifecycle.ts | Idempotent Catalog publication implemented. Publish still requires processing ready and default US audio readiness. |
| Ingest | ReadingWork + origin_file ContentAsset; origin_kind/owner/visibility | apps/backend/src/domains/ingest/epub/work-upload.ts; Personal and Catalog wrappers | Shared parser/storage path with distinct policies implemented. Personal UI is absent. |
| Library | owned Work union user_library_item; reading_state is optional progress | apps/backend/src/domains/library/service.ts; @gloaming/shared/library; Web Library feature | GET/add/remove and consumer migration implemented. Migration 0036 rows remain a human decision. |

## Before vs After

| Concern | origin/dev 4efa89a9 | PR-05 checkpoint |
| --- | --- | --- |
| Work lifecycle | status mixed pipeline, tts and published | processing_status plus published_at |
| Access | published-only assumptions at shared read gates | owner/Admin/public-Catalog access policy |
| Publication | represented as a Work status transition | separate, idempotent published_at transition |
| EPUB ingest | Admin-oriented | shared core; Personal private owner upload and Admin Catalog ingest |
| Admin Work namespace | /admin/works and /api/admin/works | /admin/catalog/works and /api/admin/catalog/works, old aliases removed |
| Library | reading_state implied shelf membership | owned Works plus explicit Catalog saves |
| Progress/history | reading_state also implied membership | progress, history and membership separated |
| Provider scope | instance-only runtime | schema has owner_user_id; runtime remains instance-oriented |
| Frontend | existing Shelf consumers | Library feature and API migration; no broad app-shell rewrite |

## Major Deleted Legacy

Confirmed within PR-01..PR-05:
- reading_work.status storage field and processing enum values published/tts.
- requirePublished* helpers as universal read access gates.
- Admin /admin/works and /api/admin/works routes; no compatibility aliases.
- Backend Shelf domain, Shared Shelf package, Web Shelf feature/API seams and /api/shelf.
- add_to_shelf as a Reader state mutation.

Not deleted:
- /my-shelf Web route and Reader return path.
- TTS workflow step and its default-US publish-readiness requirement.
- Internal domains/works and features/admin/works naming.
- Historical user_library_item rows created by migration 0036.
- Article-like words in telemetry/admin labels are not proof of an Article content model. Article model deletion predates this audit range.

## Decision Watchlist

The README contains **10** open items: PR05-HISTORY-001 plus nine product decisions. The historical item is the only decision that can change already-migrated data. No data choice was made.

## Architecture Subtraction Candidates

Seven candidate groups for later human review; none was removed in this audit:
1. SQL and in-memory forms of Work read/public Catalog predicates represent overlapping rules.
2. The access policy's actor, predicate and orchestration files may warrant a cohesion review after all consumers are stable.
3. Catalog predicates exist for different questions (Catalog identity vs published public access); verify each real caller and keep only if those distinctions remain.
4. Personal and Admin multipart handlers repeat transport size/field validation around the shared ingest core.
5. Library and Reader each have a local Work summary mapper.
6. Library returns a separate current card plus the items list; verify whether a current Work can be repeated in both projections and whether the UI uses both.
7. Shared/Web Library API, client and public seam are separate files; retain only where the public consumer boundary needs them.

These are candidates, not defects. The shared EPUB core has separate real Personal and Catalog consumers, so that abstraction is supported by current call sites.

## Frontend Readiness

### Backend now supports

- Owner reads for private Personal Works and published Catalog reads under PR-02 policy.
- Authenticated Personal EPUB upload at POST /api/works.
- Library read, explicit Catalog save and removal at /api/library.
- Reader progress and reading history independent of Library membership.
- Discover/Book Detail membership calls through the Library API.

### Backend still missing

- Provider resolver and user-scoped Provider runtime; owner_user_id is schema groundwork only.
- Settings APIs/runtime and Settings UI.
- Learner upload interface, processing/failure/retry UI, personal Work deletion semantics.
- Library summary fields for processing status and explicit source/membership kind.
- Any claim of Legacy Remaining = 0 or full epic regression acceptance.

### Requires UI/Product discussion before frontend work

- Migration 0036 historical membership treatment and any notice to users.
- Product records conflict: mvp-scope.md and prototype-flow/older MVP docs still describe Add to Shelf creating ReadingState, while accepted ADR-001 says membership and progress are separate. Resolve the records before treating either as current UI behavior.
- Library name/route, Personal vs Catalog source labels, upload location, processing states and delete/remove distinction.
- Saved Catalog membership during unpublish, repeated upload semantics, fixed result cap/order, and Catalog Admin copy.
- No new visual or interaction answer is supplied by this audit.

## Verification Evidence

Historical targeted results recorded by the PR stage reports:
- PR-01: Shared 14/14; DB constraint 4/4; Work EPUB 19/19; Backend focused regression 97 tests; Web 33/33; scoped typechecks/lint passed.
- PR-02: Backend 47/47; Backend typecheck/lint passed.
- PR-03: Backend 35/35 and Shared 14/14; Backend/Web typecheck and scoped lint passed.
- PR-04: Backend 25/25, Shared 15/15, Web 5/5; scoped typechecks/lint/format passed.
- PR-05: Library 3/3; regression 9/9; taxonomy 4/4; Shared 154/154; Web 47/47; Backend/Web/Shared typechecks and scoped lint/format passed.
- PR-05 full Backend suite was not run. Full monorepo suite was not reported as run across these stages.
- Results above are prior-run evidence, not rerun during this document-only gate.

## Risk Findings

Count: 6.
1. Migration 0036 blanket backfill may overstate historical Library intent; no selective provenance is confirmed.
2. Active product-flow records conflict with the amended accepted ADR on Shelf membership vs progress.
3. Provider owner columns exist without user-scoped Provider runtime; do not treat schema as capability.
4. Library DTO omits Personal processingStatus/source kind, and no learner upload/processing UI exists.
5. No executable Legacy Remaining = 0 gate was found; epic closeout is not verified.
6. Full Backend and full monorepo verification remain unrun/not reported; targeted results are not full-suite evidence.

## Maintainer Handoff

### 1. What are the 15 most important changes?

1. reading_work.status was removed.
2. Work processing uses processing_status.
3. Publication uses published_at.
4. Old tts/published values migrate to ready.
5. user_library_item was added with user/work uniqueness.
6. Provider/config tables gained owner_user_id schema.
7. WorkReadActor provides transport-independent identity.
8. Owner/Admin/published-Catalog read policy is shared across consumers.
9. Assets and AI context follow Work access rather than universal publication.
10. publishWork became Catalog-scoped and idempotent.
11. Personal EPUB upload is authenticated and creates private owner Works.
12. Personal and Catalog ingest share storage/parser core but retain separate policy.
13. Admin Work pages/API/audio moved to Catalog namespace without aliases.
14. TTS is a workflow step rather than a Work processing status; the publish audio gate remains.
15. Library membership, progress, history and Continue Reading are separate projections.

### 2. Which old architecture was actually deleted?

The Work status field, universal requirePublished helpers, old Admin endpoint/page paths, Shelf backend/shared/web domain/API modules, and add_to_shelf action were removed. They were not kept as runtime aliases. The Article model was already outside this range.

### 3. Which concepts were renamed but still remain?

Admin Work was renamed externally to Admin Catalog, but internal works/admin/works module names remain. Shelf became Library in service/API/contracts, but /my-shelf remains the route. TTS left the Work status enum but remains a workflow step and publish gate. published became published_at, not removed. Provider ownership became expressible in schema but is not a working user-provider capability.

### 4. Which new abstractions deserve review?

The Access actor/predicate/policy split, parallel SQL/row predicates, shared EPUB ingest core plus wrappers, Catalog predicate forms, per-feature Work summary mappers, and Library's multiple API/client/public files. The shared ingest core is used by both Personal and Catalog flows and has direct current value.

### 5. Where did AI make choices for the product owner?

It backfilled every old reading_state as a Library save, mapped old published and tts to ready, selected settings primary-key/index implementation, made same-hash uploads reuse bytes while creating distinct Works, kept saved rows through unpublish, selected Library ordering and a 50-item cap, returned no origin/processing state in Library DTO, and retained /my-shelf. These choices and their current effects are documented; no pending data decision was silently applied.

### 6. Which decisions must be discussed before the next phase?

Resolve migration 0036; confirm Library identity/source labels and route; specify upload/processing/failure and personal deletion; decide unpublish membership and repeated-upload behavior; reconcile active product-flow docs with ADR-001; and review provider ownership/runtime expectations before Provider work.

### 7. If User-first development stops here, what state is the system in?

PR-01 through PR-05 code exists through the local checkpoint. Schema, access, publication, ingest and Library backend domains are implemented with targeted historical validation. PR-05 awaits human review. Provider user scope is not implemented at runtime, Settings is not implemented, broad User-first frontend work is not started, historical Library membership is unresolved, and Legacy Remaining = 0 is not proven.

### 8. Is the backend ready for a User-first Frontend Vertical Slice?

Partially. It supports a Library/Reader slice: ownership-aware reading, Library GET/add/remove, progress/history separation, and backend Personal upload. It does not provide a complete Personal upload lifecycle to the UI: Library DTO omits processing/source kind, there is no upload UI or delete flow, and product records conflict on old Shelf behavior. A narrow Library/Reader slice has backend foundations; a complete upload-and-library experience still needs product/API decisions.

### 9. What is the impact of going to PR-06 Provider before Frontend?

PR-01 supplied nullable owner_user_id and partial uniqueness constraints. Existing Admin Provider/LLM/TTS services still query and mutate instance configuration; there is no user resolver, user CRUD contract, scope-aware UI or user fallback behavior. PR-06 can build on the schema, but must define runtime ownership and protect existing Admin instance behavior. This is dependency analysis only; it does not select sequencing.

### 10. Where should Review Gate 02 go?

Recommended after PR-07 Settings implementation is complete and before broad User-first Frontend work starts. That gate can review Provider plus Settings as one scope/ownership boundary, then leave the frontend to consume a human-reviewed backend contract.
