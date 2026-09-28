# PR-04 - Unified Ingest and Catalog

Status: Implemented
Implementation Commit: d16ee9ce82e9e5a7015b30b7dee4435dd96b1a04
Base Commit: dac344508f8f10faa38aed1721e8bab49a3572c3
Branch: codex/user-first-pr04-ingest-catalog
Primary Domain: EPUB ingest, Personal Work ownership, Catalog operations
Implementation Scope: Share EPUB persistence/parser entry while separating Personal and Admin Catalog policies
Review Type: Architecture Audit / Maintainer Handoff
Human Review: Pending

## 1. Why This Stage Exists

The existing EPUB pipeline was Admin-oriented. Personal uploads need the same parsing/storage machinery but different ownership, visibility, authentication, lifecycle, and listing rules. Admin Work naming also hid that the Admin surface manages the official Catalog. PR-04 introduced the Personal upload boundary and made Admin Catalog operations explicit.

## 2. Before

- Admin EPUB ingest owned upload, persistence, and queue preparation.
- No learner-authenticated upload route existed.
- Admin work/API pages used /admin/works and /api/admin/works.
- Work-audio Admin paths used /api/admin/works and /api/admin/parts.
- Busy/TTS filtering was inferred or post-filtered in Web.
- Personal Work ownership and Catalog-only query rules were not separate runtime capabilities.

## 3. After

- ingest/epub/work-upload.ts owns shared EPUB spec, filename sanitization, source storage/reuse, Work/asset persistence, and parse enqueue fencing.
- Personal wrapper creates origin_kind=user_epub, owner_user_id=current user, visibility=private and enqueues parse.
- Catalog wrapper creates ownerless catalog Work and preserves existing Catalog workflow policy.
- Authenticated POST /api/works creates a Personal Work.
- Admin pages and APIs move to /admin/catalog/works and /api/admin/catalog/works, with no old Admin aliases.
- Admin audio routes become Work/Part scoped under Catalog.
- workflowStep=tts is filtered server-side. Default workflow auto-chain remains off.

## 4. Git Change Summary

51 paths: 6 added, 39 modified, 1 deleted, 5 renamed. 34 production paths, 15 test paths and 4 documentation paths. No DB schema/migration or dependency change.

## 5. File-by-file Change Inventory

Shared ingest and policies:
- apps/backend/src/domains/ingest/epub/work-upload.ts - common upload spec, sanitization, object acquisition, persistence and parse enqueue.
- apps/backend/src/domains/ingest/parser/epub-parser.ts; registry.ts; service.ts - parser input/dispatch/service flow supports the shared Work ingest.
- apps/backend/src/domains/works/personal/personal-epub-upload.ts - Personal ownership/visibility wrapper.
- apps/backend/src/domains/works/catalog/policy.ts - ownerless Catalog predicate and row check.
- apps/backend/src/domains/works/admin/catalog-epub-ingest.ts - Catalog upload/reuse wrapper.
- apps/backend/src/domains/works/admin/admin-epub-ingest.ts - removed former combined/Admin-named ingest owner.
- apps/backend/src/domains/works/routes/personal.ts - authenticated Personal upload transport.
- apps/backend/src/domains/works/routes/admin.ts; index.ts - Admin Catalog route registration/name and endpoint migration.
- apps/backend/src/domains/works/admin/admin-lifecycle.ts; admin-work-read.ts; admin-work-write.ts; admin/index.ts - Admin Catalog scoping and ingest exports.
- apps/backend/src/domains/assets/routes/content-assets.ts - Admin audio reads/generation move under Catalog Work/Part paths.
- apps/backend/src/application/commands/delete-work.ts; retry-workflow.ts; run-content-parse-workflow.ts; apps/backend/src/application/jobs/content-parse.ts - shared parser/workflow command integration and owner-safe lifecycle behavior.

Web route and Admin consumer changes:
- apps/web/app/admin/works/[id]/page.tsx -> apps/web/app/admin/catalog/works/[id]/page.tsx
- apps/web/app/admin/works/[id]/preview/page.tsx -> apps/web/app/admin/catalog/works/[id]/preview/page.tsx
- apps/web/app/admin/works/[id]/preview/part/[partId]/page.tsx -> apps/web/app/admin/catalog/works/[id]/preview/part/[partId]/page.tsx
- apps/web/app/admin/works/new/page.tsx -> apps/web/app/admin/catalog/works/new/page.tsx
- apps/web/app/admin/works/page.tsx -> apps/web/app/admin/catalog/works/page.tsx
- apps/web/constants/index.ts - route constant follows Catalog namespace.
- apps/web/features/admin/works/work-audio-panel.tsx; works-api.ts; works-list-page.tsx; works-model.ts; works-model.spec.ts - Admin client, audio paths, and server workflowStep filter.
- packages/shared/src/works/works.ts; works.spec.ts; index.ts - upload contract/workflow query changes.

Tests (15):
- apps/backend/tests/functional/domains/assets/reader-audio.spec.ts
- apps/backend/tests/functional/domains/assist/assist.spec.ts
- apps/backend/tests/functional/domains/ingest/epub-gutenberg.spec.ts
- apps/backend/tests/functional/domains/ingest/epub-ingest.spec.ts
- apps/backend/tests/functional/domains/metadata/metadata-enrich.spec.ts
- apps/backend/tests/functional/domains/metadata/metadata-fill.spec.ts
- apps/backend/tests/functional/domains/reading/reader.spec.ts
- apps/backend/tests/functional/domains/reading/reading-history.spec.ts
- apps/backend/tests/functional/domains/shelf/shelf.spec.ts
- apps/backend/tests/functional/domains/taxonomy/taxonomy-ssot.spec.ts
- apps/backend/tests/functional/domains/works/personal-epub-upload.spec.ts
- apps/backend/tests/functional/domains/works/work-access-policy.spec.ts
- apps/backend/tests/functional/domains/works/works-epub.spec.ts
- apps/web/features/admin/works/works-model.spec.ts
- packages/shared/src/works/works.spec.ts
- The changed specs cover upload parsing, owner isolation, Admin Catalog isolation, audio, and workflow filtering.

Documentation:
- docs/adr/001-reading-content-domain-model.md - records Personal upload and Catalog boundaries.
- docs/plans/user-first-architecture-implementation.md - implementation status and checks.
- docs/product/engineering-vocabulary.md - namespace/status vocabulary.
- docs/testing/mvp-e2e-test-guide.md - Admin/Personal route evidence updates.

## 6. Symbol / Method Inventory

Added: EPUB_UPLOAD_SPEC, sanitizeEpubFileName, storeEpubSource, reuseEpubSource, createEpubIngestWork, enqueueCoreEpubParse, createPersonalEpubWork, createCatalogEpubWork, reuseCatalogEpubWork, catalogWorkPredicate, isCatalogWork, personalWorkRoutes, catalogAdminRoutes.
Refactored: parser dispatch and service, admin upload exports/routes, Work retry/delete/parse command paths, audio route paths, Admin list filtering.

## 7. Deleted Code Inventory

- Former admin-epub-ingest.ts implementation was deleted and responsibility split between shared work-upload.ts and catalog-epub-ingest.ts.
- Old /admin/works pages were renamed to /admin/catalog/works.
- No compatibility aliases for former Admin API paths were added.
- No parser, asset, Work, or DB data was deleted by this stage.

## 8. Database / Data Model

No migration/schema change. Personal upload writes a ReadingWork with user_epub, private visibility and current owner, plus origin_file ContentAsset. Catalog upload writes admin_epub, owner null and catalog visibility. Both use the same asset object acquisition and parser core. Shared contract adds/uses personal upload response/workflow fields.

## 9. API Change Inventory

Added: POST /api/works (auth required; multipart field file).
Renamed all Admin Work operations from /api/admin/works... to /api/admin/catalog/works... including create/list/read/update/publish/unpublish/retry/delete and EPUB upload/reuse.
Moved Admin work audio read/generation to /api/admin/catalog/works/:workId/audio and /api/admin/catalog/works/:workId/parts/:partId/audio.
No aliases remain for the old Admin routes. Query contract includes workflowStep=tts so server returns matching busy rows.

## 10. Runtime Call Flow

Personal: authenticated multipart route -> validate size/field -> createPersonalEpubWork -> shared source store/reuse -> createEpubIngestWork(owner/current user, private, user_epub) -> enqueueCoreEpubParse -> existing parse worker and pipeline -> PR-02 owner read policy permits Reader.
Catalog: requireAdmin Catalog route -> createCatalogEpubWork/reuse -> same shared storage/persistence core -> Catalog-specific auto-chain policy -> existing Admin processing/review/publish.
Admin list: Web workflowStep=tts query -> server list projection/filter. It does not rely on a browser-side second filter.

## 11. Behavioral Changes

- Users can submit a private Personal EPUB through API without Admin role.
- Admin still manages only Catalog Works.
- Parser/persistence is shared; access and lifecycle policy are not.
- Personal parsing is enqueued; Catalog follows the existing auto-chain flag, default false.
- Work audio operations are Catalog-scoped.
- This stage does not create Library membership for Personal Works; ownership membership projection arrives in PR-05.

## 12. AI-made / Implementation Decisions

- A content hash may reuse stored object bytes, but every upload call creates a new ReadingWork. Object deduplication is not book/work deduplication; repeated-upload product semantics remain open.
- Personal upload starts parse immediately while Catalog auto-chain remains policy-controlled.
- Client file name is sanitized to a basename and used as display metadata, never object path.
- The shared boundary is the ingest core; Personal and Catalog wrappers intentionally own different policy.
- No API compatibility aliases were added, following the locked one-time migration direction.

## 13. Tests & Verification Evidence

Historical PR-04 report: Shared/Backend/Web typechecks passed; Backend targeted tests 25/25, Shared 15/15, Web 5/5; scoped ESLint, Prettier and git diff check passed. Personal upload tests verified successful private parse/read, other-user/anonymous denial, Admin Catalog isolation, no TTS requirement for Personal parsing, and malformed EPUB failure handling. Results not rerun in Review Gate 01; full repository test suite not reported.

## 14. Legacy Audit

- Admin /works runtime paths were replaced with Catalog paths and no aliases.
- Admin-only upload is no longer the only ingest entry; POST /api/works is Personal.
- No personal upload UI is present.
- TTS is a workflow step, not Work processingStatus. Catalog publish gate still requires ready default US audio.
- Existing Shelf and reading_state membership semantics remain until PR-05.

## 15. Scope Audit

All changes support shared ingest, Personal backend upload, Catalog route ownership, workflow query behavior, and their consumers/tests/docs. No Library domain/UI, provider resolver, settings UI, or schema change. Admin Web page relocation is the necessary route consumer migration, not the later User-first learner frontend rewrite.

## 16. Frontend Impact

Admin pages were relocated and Admin clients updated to Catalog paths. Learner upload UI was not added. No Library UX or full user-first navigation redesign was implemented.

## 17. Complexity Growth

Added one shared EPUB ingest core and two real policy wrappers with two real consumers. Catalog predicate has SQL and row forms for different execution boundaries. Route handlers retain separate multipart validation. Later review should check whether validation duplication can be reduced without merging Personal/Admin policy.

## Architecture Subtraction Candidates

- isCatalogWork has a real caller in delete-work.ts. Review whether its row-only policy should remain separate from catalogWorkPredicate, which is used for SQL scoping.
- Review overlap between Catalog predicate and published Catalog read predicate; their different publication requirements may justify both.
- Review route-level multipart validation duplication against the shared upload spec.

## Hidden Product Decisions

- Repeated same EPUB upload creates another Work while reusing bytes: PR04-PRODUCT-001.
- Personal upload is private and parse starts immediately; surfaced upload location and processing/retry experience are not decided here.
- Catalog unpublish and saved user membership lifetime is clarified by PR-05 source behavior but still needs product ownership.
