# PR-03 - Publication SSOT

Status: Implemented
Implementation Commit: dac344508f8f10faa38aed1721e8bab49a3572c3
Base Commit: a3f2a69dfd0d945aa1d6fce43089f9ae96e5d4b6
Branch: codex/user-first-pr03-publication-ssot
Primary Domain: Publication transition semantics
Implementation Scope: Make repeated publish calls preserve the first publishedAt and handle concurrent transitions
Review Type: Architecture Audit / Maintainer Handoff
Human Review: Pending

## 1. Why This Stage Exists

With publication represented by published_at, repeated publish calls should not rewrite publication history or report a failure merely because a concurrent request won the transition.

## 2. Before

publishWork set publishedAt to a new timestamp on every call and updated by Work id alone. Repeated publish therefore refreshed the timestamp; the update did not express a null-to-published transition or recover cleanly from a concurrent update.

## 3. After

publishWork requires processingStatus ready, checks the existing publish gate, returns unchanged if already published, and conditionally updates where publishedAt is null. A race rereads the row. At this commit, service lookup remains by Work id; Catalog-only service scoping is added later in PR-04. unpublishWork retains its existing conflict behavior.

## 4. Git Change Summary

3 modified paths, no additions/deletions: admin-lifecycle.ts, its EPUB functional spec, and the implementation plan. No schema, API shape, route registration, or Web change.

## 5. File-by-file Change Inventory

- apps/backend/src/domains/works/admin/admin-lifecycle.ts - Idempotent publish transition and race reread.
- apps/backend/tests/functional/domains/works/works-epub.spec.ts - repeated publish/first timestamp behavior and surrounding publish regression.
- docs/plans/user-first-architecture-implementation.md - records the stage and its verification.

## 6. Symbol / Method Inventory

- publishWork - idempotent Catalog publish transition.
- unpublishWork - behavior retained; still rejects unpublishing a row without publishedAt.
- buildPublishIssuesForWork - existing publication readiness/business validation remains in the call path.

## 7. Deleted Code Inventory

No function, route, schema item, or module was deleted. A conditional update and race-read path were added inside publishWork.

## 8. Database / Data Model

No schema or migration. Writes published_at only. Processing status stays ready; publication does not become a status value.

## 9. API Change Inventory

No route path, request, or response contract change. Admin publish endpoint behavior is idempotent; repeated publish preserves the first publishedAt timestamp.

## 10. Runtime Call Flow

Admin publish route (requireAdmin) -> publishWork -> ready check -> publish issue/readiness gate -> existing timestamp return OR conditional publishedAt update -> race reread -> Admin Work projection. Work-id Catalog scoping is not yet in this stage.

## 11. Behavioral Changes

Repeated publish no longer refreshes publication time. Concurrent first-publish calls converge on the already-written row. Catalog-only service scoping arrives in PR-04. Unpublish remains a separate clear-publishedAt operation with conflict if already unpublished.

## 12. AI-made / Implementation Decisions

- First publish timestamp is authoritative; repeated calls do not refresh recency. This is the stage's intended idempotency behavior.
- A lost update race is handled by rereading and returning current state instead of issuing a second transition.
- The stage leaves the default-US audio publish gate in place.

## 13. Tests & Verification Evidence

Historical PR-03 report: 8 backend functional files, 35/35 tests; Shared Work tests 14/14; Backend/Web typechecks, relevant lint and git diff check passed. ESLint reported one pre-existing Next image warning and no errors. Not rerun in Review Gate 01; full monorepo tests were not reported.

## 14. Legacy Audit

- No processingStatus='published' or 'tts' runtime usage was reported; negative contract tests may mention legacy values.
- isWorkPublished derives from publishedAt.
- Publication remains Catalog publication; owner read access from PR-02 is separate.

## 15. Scope Audit

Exactly one runtime method plus its regression test and plan record. No unrelated stage or PR-04/PR-05 runtime code.

## 16. Frontend Impact

None. Existing Admin client response shape is unchanged.

## 17. Complexity Growth

No new module or abstraction. One conditional write and one race recovery read were added to an existing lifecycle owner. Three direct testable paths remain.

## Architecture Subtraction Candidates

- No new subtraction candidate from this stage. Reassess the local post-mutation projection helper only if it becomes a forwarding wrapper without multiple callers.

## Hidden Product Decisions

- Unpublish clears publication but does not clear user_library_item rows. PR-05 Library query hides unpublished Catalog Works, so a saved item can reappear after republish. Decide whether this persistence is intended: PR03-PRODUCT-002.
- Publish readiness still requires ready default US audio; lazy/non-blocking publication is not implemented.
