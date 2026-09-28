# PR-01 - Schema Foundation

Status: Implemented
Implementation Commit: a7804424d18d122bc1e1c8ecc1a7cab8eb5729f4
Base Commit: 4efa89a9944561ad4f57b37d57f115fd78f7f43f
Branch: codex/user-first-pr01-schema-foundation
Primary Domain: Schema and shared Work lifecycle contract
Implementation Scope: Split processing from publication; create Library membership storage; add provider ownership columns
Review Type: Architecture Audit / Maintainer Handoff
Human Review: Pending

Evidence basis: commit diff 4efa89a9..a7804424, migration 0036, Drizzle schema, shared Work contracts, current source and call sites. The implementation plan is intent/verification record, not runtime proof.

## 1. Why This Stage Exists

The prior Work status mixed pipeline progress, TTS, and publication. The schema also lacked explicit Library membership storage and could not encode provider/config ownership. PR-01 established the persistence and shared-contract shape needed for Access, Ingest, Library, Provider, and Settings. It did not implement those later runtime features.

## 2. Before

- reading_work.status admitted uploaded, processing, parsed, metadata, tts, ready, failed, published.
- Publication and processing shared one field.
- reading_state was documented and used as shelf membership plus position.
- llm_provider, llm_app_setting, and tts_config had no owner_user_id.
- Shared Work DTOs and Admin filters exposed the combined status model.

## 3. After

- reading_work.processing_status contains uploaded, processing, parsed, metadata, ready, failed.
- reading_work.published_at is the publication fact; Work DTO and Admin list query expose processingStatus and publicationStatus separately.
- user_library_item exists with unique user_id/work_id and user/work indexes.
- Provider/config tables have nullable owner_user_id and scoped uniqueness constraints.
- Admin and workflow code use processingStatus. Access policy and Library CRUD came later.

## 4. Git Change Summary

55 changed paths: 3 added, 52 modified, 0 deleted. The range adds migration 0036 and its journal entry, changes the DB schema, updates backend/web consumers, changes 17 test paths and 3 documentation paths. No route registration file changed.

## 5. File-by-file Change Inventory

Production paths (36):
- apps/backend/scripts/seed-dev-works.ts - seed data uses processingStatus.
- apps/backend/src/application/commands/advance-tts-workflow.ts; delete-work.ts; retry-workflow.ts; run-content-parse-workflow.ts - workflow/deletion commands use the new Work lifecycle field.
- apps/backend/src/application/jobs/metadata-enrich.ts - job transitions use processingStatus.
- apps/backend/src/domains/ai/runtime/purpose-model.ts - instance setting lookup is owner-null scoped.
- apps/backend/src/domains/assets/content/published.ts; gateway/service.ts - publication/access projections use publishedAt facts.
- apps/backend/src/domains/llm/config/settings/service.ts - instance settings use owner_user_id null.
- apps/backend/src/domains/metadata/enrich/workflow-service.ts; workflow.ts - metadata transitions use processing status.
- apps/backend/src/domains/recommendations/service.ts - Catalog visibility uses publication time.
- apps/backend/src/domains/shelf/service.ts - Shelf uses publishedAt but still derives membership from reading_state at this stage.
- apps/backend/src/domains/works/admin/admin-epub-ingest.ts; admin-lifecycle.ts; admin-work-read.ts; admin-work-write.ts - Admin ingest, filtering, publication and DTO mapping use separated fields.
- apps/backend/src/domains/works/catalog/catalog.ts - public Catalog filtering uses publishedAt.
- apps/backend/src/domains/works/lifecycle/workflow.ts - workflow claims/transitions use processingStatus.
- apps/backend/src/domains/works/read-model/access.ts; projection.ts - access and Work projection use new fields.
- apps/web/features/admin/works/metadata-review-panel.tsx; works-api.ts; works-edit-page.tsx; works-format.ts; works-list-page.tsx; works-model.spec.ts; works-model.ts; works-preview-page.tsx - Admin UI/API filters and labels follow the split.
- apps/web/features/book-detail/book-detail-model.spec.ts; apps/web/features/discover/discover-api.spec.ts - consumers' contract tests follow the revised Work shape.
- packages/db/src/index.ts; schema.ts - DB exports/model definitions updated.
- packages/shared/src/works/index.ts; works.spec.ts; works.ts - Shared status enum, schema, and DTO contract changed.

Migration paths:
- packages/db/migrations/0036_user_first_pr01_schema_foundation.sql - creates membership; migrates status; adds owner columns/indexes; backfills from every reading_state row.
- packages/db/migrations/meta/_journal.json - registers migration 0036.

Documentation paths:
- docs/adr/001-reading-content-domain-model.md - User-first schema direction amended.
- docs/plans/user-first-architecture-implementation.md - sequence and implementation scope recorded.
- docs/product/engineering-vocabulary.md - status and field vocabulary updated.

Test paths (17):
- apps/backend/tests/functional/domains/assets/assets.spec.ts
- apps/backend/tests/functional/domains/db/user-first-pr01-schema-constraints.spec.ts
- apps/backend/tests/functional/domains/dictionary/dictionary-config.spec.ts
- apps/backend/tests/functional/domains/ingest/epub-gutenberg.spec.ts
- apps/backend/tests/functional/domains/ingest/epub-ingest.spec.ts
- apps/backend/tests/functional/domains/llm/llm-config.spec.ts
- apps/backend/tests/functional/domains/metadata/metadata-enrich.spec.ts
- apps/backend/tests/functional/domains/metadata/metadata-fill.spec.ts
- apps/backend/tests/functional/domains/taxonomy/taxonomy-ssot.spec.ts
- apps/backend/tests/functional/domains/translate/translate.spec.ts
- apps/backend/tests/functional/domains/works/catalog-taxonomy.spec.ts
- apps/backend/tests/functional/domains/works/works-epub.spec.ts
- apps/backend/tests/unit/domains/taxonomy/read-side-taxonomy-contract.spec.ts
- apps/web/features/admin/works/works-model.spec.ts
- apps/web/features/book-detail/book-detail-model.spec.ts
- apps/web/features/discover/discover-api.spec.ts
- Tests adapt relevant Work consumers; the DB constraint spec covers membership/provider scope uniqueness.

## 6. Symbol / Method Inventory

- Added/authoritative: userLibraryItem, userLibraryItemRelations, WORK_PROCESSING_STATUSES, WorkProcessingStatus, workProcessingStatusSchema, WORK_PROCESSING_STATUS_LABELS, processingStatus/publicationStatus DTO and query fields.
- Refactored: Admin Work readers/writers, Work projection/access, pipeline commands/jobs, Admin work model/filter helpers, TTS workflow transitions.
- Changed publication consumers: isWorkPublished and Catalog/Shelf/access predicates derive publication from publishedAt.
- Provider ownership is schema-only here; no user provider resolver or user settings methods were added.

## 7. Deleted Code Inventory

- reading_work.status was removed by migration and schema update.
- WorkStatus, WORK_STATUSES, workStatusSchema, and labels carrying published/tts as processing statuses were replaced.
- No API route, service, or directory was deleted in this stage.

## 8. Database / Data Model

Migration 0036 maps old tts and published status values to ready; other known values copy through. It creates user_library_item and inserts one row for every reading_state row, preserving added_at as created_at. This is a blanket backfill, not recovered user intent. Provider/config owner columns are nullable; partial unique indexes separate instance/user setting keys and enforce one instance TTS config. This is the only versioned schema migration touched in PR-01..05.

## 9. API Change Inventory

No route registrations changed. Shared Admin Work payloads/list-query contracts changed from status to processingStatus plus publicationStatus; old status is not a compatibility alias. Admin path changes belong to PR-04; Library API belongs to PR-05.

## 10. Runtime Call Flow

Admin list/edit -> Admin Work service -> processingStatus and publishedAt filters/projection.
Parse, metadata, retry, TTS commands -> Work lifecycle transitions -> processing_status.
Catalog/Shelf/asset visibility -> published_at predicate.
Migration 0036 -> membership rows and owner-capable provider schema. Provider runtime behavior does not yet use user ownership.

## 11. Behavioral Changes

- TTS and publication cease to be processingStatus values.
- Existing tts/published rows become processing-ready; publication is represented by published_at.
- At this stage, reading_state still drives Shelf membership.
- Provider services still operate as instance configuration.

## 12. AI-made / Implementation Decisions

- Migration translates both tts and published to ready. This follows the split but chooses the fallback processing value for legacy rows.
- It copies every reading_state row to user_library_item and uses added_at as membership time. No provenance distinguishes explicit saves from auto-open; see PR05-HISTORY-001.
- llm_app_setting changes from key primary key to generated id plus partial unique indexes. This is a storage implementation choice; purpose/key contract remains.
- Unknown legacy status values fail migration rather than being silently coerced.

## 13. Tests & Verification Evidence

Historical stage report / plan records:
- Shared Work contract: 14/14.
- PR-01 schema constraints: 4/4 on gloaming_test.
- Work EPUB regression: 19/19; focused Backend functional set: 13 files / 97 tests.
- Web Admin/Book Detail/Discover: 33/33.
- Shared, Backend, Web typechecks and scoped lint passed.
- These historical results were not rerun in Review Gate 01. Full monorepo tests/typecheck/lint were not reported as run for this stage.

## 14. Legacy Audit

- Confirmed removed: DB/runtime reading_work.status and processing enum members tts/published.
- Replaced, not removed: publication continues as published_at; tts continues as workflow step and asset-readiness requirement.
- Still present here: reading_state-derived Shelf membership; PR-05 later replaces runtime semantics.
- Provider owner columns are not runtime user scoping.

## 15. Scope Audit

The range is schema foundation plus consumers required for the new field contract. No provider UI/resolver, Library API, user read-access policy, Admin route move, or Settings flow is implemented. The blanket Library backfill belongs to the schema stage and remains a human data decision.

## 16. Frontend Impact

Admin Work status display/filtering separates processing from publication. Discover and Book Detail contract tests follow the revised Work shape. This is not the User-first frontend rewrite; no Library page or user settings UI is introduced.

## 17. Complexity Growth

Added one membership table, provider ownership fields/indexes, and processing/publication contract separation. These are required persistence facts for distinct lifecycle/ownership concepts. Review the partial-index constraints and status/backfill choices; no forwarding wrapper was added.

## Architecture Subtraction Candidates

- Revisit whether both SQL and in-memory publication predicates are needed after PR-02; both may be required for query and loaded-row paths.
- Review provider ownership constraints together with PR-06 before claiming user-scoped provider support.

## Hidden Product Decisions

- Historical reading_state backfill semantics: PR05-HISTORY-001.
- Legacy tts/published rows both become processing-ready. Confirm whether operators need a distinct migrated processing stage.
