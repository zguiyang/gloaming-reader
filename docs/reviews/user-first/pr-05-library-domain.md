# PR-05 - Library Domain

Status: Implemented
Implementation Commit: dd60b348a482268f126a2de936941a120225f005
Base Commit: d16ee9ce82e9e5a7015b30b7dee4435dd96b1a04
Branch: codex/user-first-pr05-library-domain
Primary Domain: Library membership, reading progress and history
Implementation Scope: Replace Shelf domain/API/contract with owned-plus-saved Library and separate Continue Reading
Review Type: Architecture Audit / Maintainer Handoff
Human Review: Pending

## 1. Why This Stage Exists

Before PR-05, reading_state served both progress and Shelf membership. That made an automatic open indistinguishable from an explicit save. PR-05 makes Personal ownership imply Library presence, Catalog presence require user_library_item, and reading_state an optional progress decoration. Reading history remains its own behavior record.

## 2. Before

- Backend GET /api/shelf returned works based on reading_state.
- Shared ShelfData/ShelfItem and packages/shared/shelf represented the contract.
- Web features/shelf consumed the Shelf API from /my-shelf.
- updateReadingState accepted add_to_shelf.
- Book Detail combined progress and membership behavior.

## 3. After

- GET /api/library returns owned Personal Works union explicit published Catalog saves, each with optional reading state.
- Continue Reading is queried separately from accessible in_progress reading_state and can be unsaved.
- POST /api/library/:workId adds a published Catalog membership; duplicate add is a successful no-op.
- DELETE /api/library/:workId removes only user_library_item; reading_state remains.
- Opening/restarting can create progress but cannot create Library membership.
- Shared and Web modules are named library; /my-shelf path remains.

## 4. Git Change Summary

64 paths: 12 added, 33 modified, 12 deleted, 7 renamed. 47 production source paths, 14 test paths, 9 docs paths. No migration/schema behavior or dependency changed; packages/db/src/schema.ts changes a comment only.

## 5. File-by-file Change Inventory

Backend Library and route composition:
- apps/backend/src/domains/library/index.ts; routes/index.ts; service.ts - new Library owner, authenticated GET/POST/DELETE routes, union/progress projection, idempotent membership changes.
- apps/backend/src/routes/index.ts - mounts libraryRoutes in place of shelfRoutes.
- apps/backend/src/domains/shelf/index.ts; routes/index.ts; service.ts - removed Shelf backend module.

Reader, history, and tests:
- apps/backend/src/domains/reading/reader/state-mutations.ts - add_to_shelf action removed; open/restart retain progress creation.
- apps/backend/tests/functional/domains/library/library.spec.ts - explicit membership, read model and idempotency cases.
- apps/backend/tests/functional/domains/reading/reader.spec.ts; reading-history.spec.ts - assert progress/history no longer imply membership.
- apps/backend/tests/unit/domains/taxonomy/read-side-taxonomy-contract.spec.ts - Library taxonomy contract coverage.
- apps/backend/tests/functional/domains/shelf/shelf.spec.ts - old suite removed and replaced by Library tests.

Web page and feature migration:
- apps/web/app/(app)/my-shelf/page.tsx - route composes Library feature while path is retained.
- apps/web/features/shelf/shelf-book-card.tsx -> apps/web/features/library/library-book-card.tsx
- apps/web/features/shelf/shelf-continue-hero.tsx -> apps/web/features/library/library-continue-hero.tsx
- apps/web/features/shelf/shelf-empty-state.tsx -> apps/web/features/library/library-empty-state.tsx
- apps/web/features/shelf/shelf-grid.tsx -> apps/web/features/library/library-grid.tsx
- apps/web/features/shelf/shelf-page.tsx -> apps/web/features/library/library-page.tsx
- apps/web/features/shelf/shelf-skeleton.tsx -> apps/web/features/library/library-skeleton.tsx
- apps/web/features/shelf/shelf-taxonomy.spec.ts -> apps/web/features/library/library-taxonomy.spec.ts
- apps/web/features/library/index.ts; library-api.ts; library-client.ts; library-public.spec.ts; library-public.ts - new Library client, public seam and its tests.
- apps/web/features/shelf/index.ts; shelf-api.ts; shelf-public.spec.ts; shelf-public.ts - old API/public seam deleted.
- apps/web/features/reading-state/reading-state-api.ts; reading-state-client.ts - old add/save coupling removed; API client deleted.
- apps/web/features/book-detail/book-detail-api.ts; book-detail-hero.tsx; book-detail-model.ts; book-detail-model.spec.ts; book-detail-page.tsx - membership mutation/query separated from progress.
- apps/web/features/discover/discover-api.ts; discover-api.spec.ts; discover-book-card.tsx; discover-model.ts - explicit Library actions integrated in Discover.
- apps/web/features/reader/reader-api.ts; apps/web/lib/api-request.spec.ts - endpoint/client contract updates.

Shared contracts and copy:
- packages/shared/src/library/index.ts; library.ts; library.spec.ts - Library DTO, limits and schemas replace Shelf contract.
- packages/shared/src/shelf/index.ts; shelf.ts; shelf.spec.ts - old Shared module removed.
- packages/shared/src/reader/reader.ts - add_to_shelf removed from reading-state actions.
- packages/shared/src/public-exports.spec.ts; packages/shared/package.json - public subpath and export assertions migrate to library.
- packages/db/src/schema.ts - membership comment now describes Library and separate progress; schema is unchanged.
- packages/i18n/src/messages/en-US.json; packages/i18n/src/messages/zh-CN.json - Shelf-facing copy moves to Library language.

Documentation (9):
- docs/adr/001-reading-content-domain-model.md - accepted domain split and current Library/Continue Reading semantics updated.
- docs/adr/003-shared-package-public-api-strategy.md - Shared module map updated.
- docs/adr/006-frontend-shelf-and-reader-parts-public-seams.md - frontend seam decision updated.
- docs/plans/user-first-architecture-implementation.md - PR-05 completion recorded.
- docs/product/BOOK_DETAIL_DESIGN_CONTEXT.md; content-strategy.md; engineering-vocabulary.md; feature-audit.md - product/domain vocabulary and current surfaces updated.
- docs/testing/mvp-e2e-test-guide.md - endpoint/page evidence path updated.

## 6. Symbol / Method Inventory

Added: LibraryData, LibraryItem, LIBRARY_ITEMS_LIMIT, libraryDataSchema/libraryItemSchema, getLibrary, addToLibrary, removeFromLibrary, libraryRoutes, library API/client/public seams.
Changed: updateReadingState no longer creates membership on add_to_shelf; Book Detail/Discover models use Library state separate from reader progress.
Removed: ShelfData/ShelfItem exports and shelf route/service/API/client/public symbols; add_to_shelf action.

## 7. Deleted Code Inventory

- Backend domains/shelf, Shared packages/shared/shelf, and Web features/shelf implementations/API/public seams were removed or moved to library.
- reading_state add_to_shelf mutation path and Web reading-state-client were removed.
- /api/shelf is removed with no alias. /my-shelf route is retained intentionally.
- Migration 0036 and its data are unchanged.

## 8. Database / Data Model

No new database structure in PR-05. user_library_item from migration 0036 is now the membership SSOT. Owned Works are selected by reading_work.owner_user_id=user; saved Catalog Works join user_library_item and require published Catalog visibility. reading_state is left-joined as optional progress. Migration 0036's historical blanket backfill remains unresolved.

### Historical Library Backfill Decision

Current fact: migration 0036 inserts a user_library_item for every row in reading_state and uses added_at for created_at. Original reading_state rows may have come from explicit save or automatic open/read. No confirmed row field records why it was created.

Impact: only rows present at migration time are ambiguous. New behavior does not infer Library membership from reading_state.

- Preserve all: keeps intentional historical saves, but also keeps any automatically-created states as apparent saves.
- Delete all: removes false positives, but also permanently removes true intentional saves unless another source can restore them.
- Selective recovery: requires a provenance source. A discriminator in reading_state/migration 0036 is Not Confirmed; no reliable classification evidence was found in the schema or migration.
- Decision: Needs Human Product/Data Decision. No deletion, new backfill, migration, or selection was performed.

## 9. API Change Inventory

- GET /api/library replaces GET /api/shelf.
- POST /api/library/:workId adds explicit membership, limited to a published Catalog Work.
- DELETE /api/library/:workId removes membership only and succeeds when no row exists.
- Existing Reader state GET/PATCH remains; add_to_shelf is removed from its action contract.
- Shared Library item Work projection includes id, title, description, tags, coverAssetId, publishedAt and optional state; it does not expose processingStatus or an explicit origin/membership-kind field.

## 10. Runtime Call Flow

Library page at /my-shelf -> Library client -> GET /api/library -> getLibrary:
  current = latest accessible in_progress ReadingState + Work
  items = owned Works UNION explicit saved published Catalog Works, each with optional state
Discover/Book Detail -> POST/DELETE /api/library/:workId -> addToLibrary/removeFromLibrary -> user_library_item only.
Reader PATCH open/restart -> updateReadingState -> reading_state only; no membership write.
Reading history -> existing history query/heartbeat -> history behavior remains independent.

## 11. Behavioral Changes

- Read Catalog no longer automatically adds Library membership.
- A saved Catalog Work may have no progress row.
- Removing a Catalog Work from Library preserves reading progress/history.
- Personal Works are naturally Library members by ownership.
- Current Continue Reading can show an unsaved Work.
- Current API returns a combined list capped at 50 and sorts owned by Work creation and saved Catalog by membership creation, then merges by that timestamp.

## 12. AI-made / Implementation Decisions

- Continue Reading stays in the Library response/page while its query remains logically separate.
- Catalog membership is visible only while the Work is published; its row persists through unpublish.
- Owned and saved Works use one Work summary shape; origin and processing status are not returned in this Library projection.
- Library results use a fixed 50-item cap and newest timestamp ordering.
- Delete semantics are asymmetric by design in code: Library DELETE removes a Catalog membership row; no personal Work deletion endpoint was added.
- /my-shelf was retained as the route while API/domain language changed.

## 13. Tests & Verification Evidence

Historical PR-05 report:
- Library functional: 3/3.
- Reader/History/Access/Personal/Recommendations regression: 9/9.
- Backend taxonomy: 4/4.
- Shared: 154/154.
- Web targeted set: 47/47.
- Backend, Web, Shared typechecks; scoped ESLint, Prettier and git diff check passed.
- Full Backend suite was not run. These results were not rerun in Review Gate 01.

## 14. Legacy Audit

- Confirmed removed from runtime: Shelf backend/shared/web modules, /api/shelf, and add_to_shelf action.
- Intentionally retained: /my-shelf URL and navigation/Reader return references.
- reading_state remains for progress/history; only its Library-membership role is removed for future behavior.
- Legacy historical membership rows remain pending human decision.
- Shelf terminology remains in historical docs, old route naming, and some product documents.

## 15. Scope Audit

PR-05 is Library domain plus the consumer migrations needed to stop using Shelf and separate progress. It changes Web Library/Book Detail/Discover call sites, but does not implement learner EPUB upload UI, User-first app shell, Provider, Settings, or Lazy TTS. The doc and UI migrations are within the Library vertical slice.

## 16. Frontend Impact

Library feature replaces Shelf internals while App Router path remains /my-shelf. Discover and Book Detail expose explicit Library membership. Reader API stays on reading_state. A full navigation/route rename and Personal upload/processing flow remain unimplemented.

## 17. Complexity Growth

Adds backend Library service/routes, Shared Library contract, and Web Library feature. Existing Shelf components are mostly renamed/refined rather than wholly new. This split corresponds to distinct membership semantics. Review the combined current/items payload, single 50-item cap, local Work mapper, and missing origin/processing metadata before extending the UI.

## Architecture Subtraction Candidates

- Current in_progress Work is projected separately as current and may also occur in items; inspect UI usage and test expectations before deciding whether duplicate representation is unnecessary.
- Library service has a local Work summary mapper; compare it with existing Work/read-model mappers before keeping both.
- WorkRead SQL and in-memory predicates remain parallel representations of one access rule.
- Library API/client/public files are separate seams; each should retain its owner/consumer justification.
- Shelf compatibility modules were removed rather than left as forwarding wrappers.

## Hidden Product Decisions

- PR05-HISTORY-001 historical membership data decision.
- PR03-PRODUCT-002 unpublish/save persistence behavior.
- PR04-PRODUCT-001 repeated upload semantics.
- Library name/route, source labels/grouping, upload location/processing lifecycle, personal deletion, sort/cap, migrated-item visibility, and Admin Catalog copy remain for product review. Existing product files disagree on some source-label and Shelf-flow language; see summary risk findings.
- Existing product flow says Continue Reading belongs in this surface and Reader returns to Library; these are current documented decisions, not reopened here.
