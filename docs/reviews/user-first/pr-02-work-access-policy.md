# PR-02 - Unified Work Read Access Policy

Status: Implemented
Implementation Commit: a3f2a69dfd0d945aa1d6fce43089f9ae96e5d4b6
Base Commit: a7804424d18d122bc1e1c8ecc1a7cab8eb5729f4
Branch: codex/user-first-pr02-work-access-policy
Primary Domain: Work ownership-aware read access
Implementation Scope: Replace universal published-only access with a shared actor/policy across content consumers
Review Type: Architecture Audit / Maintainer Handoff
Human Review: Pending

## 1. Why This Stage Exists

After PR-01, the schema could represent private owner Works, but runtime reads still assumed every readable Work was published. PR-02 made one rule govern Reader, assets, conversations, Assist, translation, dictionary, history, recommendations, and Shelf.

## 2. Before

Published-only helpers gated read paths. A private Work could not be read by its owner through the same supported Reader/content call chains. Consumers had local visibility checks or depended on helper names tied to publication.

## 3. After

WorkReadActor is a transport-independent identity shape. A Work is readable by its owner, an Admin, or any actor for a published ownerless Catalog Work. SQL predicates protect query paths; canReadWorkRow protects loaded-row/asset/history paths. Parts inherit their Work's policy.

## 4. Git Change Summary

39 paths: 6 added, 31 modified, 1 deleted, 1 renamed. Adds actor, policy, predicate and access tests; renames published.ts to part-audio-track.ts. No schema, migration, Web, or public route path change.

## 5. File-by-file Change Inventory

New production files:
- apps/backend/src/domains/works/access/actor.ts - minimal WorkReadActor, anonymous/default identity and Admin role helpers.
- apps/backend/src/domains/works/access/predicate.ts - pure row checks plus SQL predicates for public Catalog and actor reads.
- apps/backend/src/domains/works/access/policy.ts - readable Work/Part loaders, title/id resolvers, and assertCanReadWork.
- apps/backend/src/domains/works/access/index.ts - internal domain exports.

Changed production paths:
- apps/backend/src/domains/assets/content/published.ts -> part-audio-track.ts - audio-track resolution uses readable-part access.
- apps/backend/src/domains/assets/gateway/service.ts; assets/index.ts; routes/assets.ts - asset visibility and delivery use actor policy.
- apps/backend/src/domains/assist/routes/index.ts; service.ts; tools.ts - Assist work/part context follows the actor.
- apps/backend/src/domains/conversations/routes/index.ts; service.ts - conversation scope checks access to its Work.
- apps/backend/src/domains/dictionary/lookup/enrichment.ts; service.ts; routes/index.ts - lookup/enrichment context uses readable content.
- apps/backend/src/domains/reading/history/query.ts; reader/service.ts; reader/state-mutations.ts; routes/history/user.ts; routes/reader.ts - history and Reader use owner-aware access.
- apps/backend/src/domains/recommendations/service.ts - only published Catalog Works are recommended.
- apps/backend/src/domains/shelf/service.ts - Shelf filters to public Catalog visibility for its rows.
- apps/backend/src/domains/translate/routes/index.ts; service.ts - translation context checks readable Parts.
- apps/backend/src/domains/works/catalog/catalog.ts; catalog/index.ts; routes/catalog.ts - public Catalog behavior shares publication predicate while non-catalog detail can use read access.
- apps/backend/src/domains/works/read-model/access.ts -> removed; read-access ownership moved to works/access. read-model/index.ts updated.
- apps/backend/src/domains/works/access modules are the central policy owner.

Tests (8):
- apps/backend/tests/functional/domains/assets/assets.spec.ts
- apps/backend/tests/functional/domains/conversations/conversations.spec.ts
- apps/backend/tests/functional/domains/dictionary/dictionary-config.spec.ts
- apps/backend/tests/functional/domains/recommendations/recommendations-catalog-policy.spec.ts
- apps/backend/tests/functional/domains/shelf/shelf.spec.ts
- apps/backend/tests/functional/domains/works/work-access-policy.spec.ts
- apps/backend/tests/unit/domains/dictionary/dictionary-context-isolation.spec.ts
- apps/backend/tests/unit/domains/dictionary/dictionary-route.spec.ts
- They cover owner, other-user, anonymous and Admin boundaries, public Catalog filters and consumer context isolation.

Documentation:
- docs/plans/user-first-architecture-implementation.md - records the Access phase and acceptance evidence.

## 6. Symbol / Method Inventory

Added: WorkReadActor, anonymousWorkReadActor, workReadActorFromIdentity, isWorkReadAdmin, WorkAccessRow, isPublicCatalogWork, canReadWorkRow, publicCatalogWorkSql, workReadAccessSql, requireReadableWorkWithParts, requireReadablePart, resolveReadableWorkTitle, resolveReadableWorkIdForPart, assertCanReadWork.
Migrated call sites include getReaderParts/getReaderPart/getReadingState/updateReadingState, asset authorization/audio resolution, conversation create/list/read, Assist, translate, dictionary, history and recommendations.

## 7. Deleted Code Inventory

- requirePublishedWorkWithParts and requirePublishedPart were replaced by ownership-aware readable helpers.
- apps/backend/src/domains/works/read-model/access.ts was deleted.
- The old published content helper filename was renamed to part-audio-track.ts; the audio track capability remains.
- Public routes and response contracts were not removed.

## 8. Database / Data Model

No schema or migration changes. Policy reads owner_user_id, visibility, and published_at added/clarified in PR-01.

## 9. API Change Inventory

No URL or response-schema change. Existing Reader/content API semantics broaden for owner access while preserving published Catalog access for non-owners. Denied and absent Works continue to resolve through not-found paths in the access helpers.

## 10. Runtime Call Flow

HTTP identity -> workReadActorFromIdentity -> service-level readable Work/Part loader or SQL predicate -> requested Reader/AI/history/asset operation.
Asset route -> asset metadata -> canReadWorkRow/isPublicCatalogWork -> authorized bytes or denial.
Catalog/recommendation query -> publicCatalogWorkSql; private Works do not enter public Catalog results.

## 11. Behavioral Changes

- Owner can read their own private Work and parts through the shared Reader policy.
- Anonymous and other-user access remains limited to published ownerless Catalog Works.
- Admin policy remains explicit.
- Assets and AI context no longer infer that publication is the only valid reason a Work can be read.

## 12. AI-made / Implementation Decisions

- The policy uses both SQL and in-memory predicates so database-filtered reads and already-loaded rows share equivalent rules. They are intentionally distinct execution forms but can drift.
- Unreadable and nonexistent Works are concealed through not-found behavior.
- Actor is a minimal plain object rather than Hono/session type so domain services stay independent of transport.
- GitNexus was stale for this stage; previous stage report records manual source/call-site review instead.

## 13. Tests & Verification Evidence

Historical PR-02 report: 13 backend regression files, 47/47 tests; Backend typecheck, ESLint and git diff check passed. A focused follow-up added Recommendations and Shelf policy regression cases. Results were not rerun in Review Gate 01. Full repository tests were not reported.

## 14. Legacy Audit

- requirePublished* was removed from active access paths, not all publication checks.
- Published Catalog remains the public-read condition for non-owners.
- Ownership-aware access is current runtime behavior; the architecture does not imply that any authenticated user can read another user's private Work.

## 15. Scope Audit

Changes are backend read policy, its consumers, and tests. No auth mechanism, table, public path, provider behavior, or Library contract changed.

## 16. Frontend Impact

No Web source changed. Existing endpoints retain their shape; owners can now read private content using those paths. Frontend Library surfaces arrived in PR-05.

## 17. Complexity Growth

Four access module files and one shared policy were added. The module has multiple real consumers across domains, so its shared ownership is evidenced. Candidate review: compare pure row predicate and SQL predicate drift; keep both if each caller requires a different query boundary.

## Architecture Subtraction Candidates

- The four-file access module may have more entrypoint structure than needed; preserve semantic separation of actor, predicates, and orchestration unless usage shows a simpler cohesive unit.
- The SQL and row predicates encode the same policy twice.

## Hidden Product Decisions

- Concealing denied and nonexistent Works behind not-found is user/security behavior; current implementation is confirmed, but error disclosure policy should remain an explicit access contract.
- Recommendations and public listing remain Catalog-only even though owners can read private Works. This is an intentional product/security distinction, not a general consequence of authentication.
