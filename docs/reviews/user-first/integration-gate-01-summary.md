# User-first Integration Gate #1

## 1. Metadata

- Date: 2026-09-29
- Branch: `dev-02`
- Worktree: `/Users/joyzhao/.codex/worktrees/dev-02/gloaming-reader`
- Final integration commit: `f83c8f3d`
- Status: **Failed** — required browser acceptance is incomplete and `/discover` rendered a blank page in the local runtime.
- Cursor used: No

## 2. Dev Base

- `DEV_BASE`: `a177dc2040738d0f9a3a49e7f2b047d946513c1c`
- The primary `dev` worktree was clean at inspection and remains unchanged.
- Local `dev` was one commit ahead of `origin/dev`; no fetch, pull, rebase, or push was performed.
- `dev-02` was created at `DEV_BASE`, not from PR-09 HEAD.

## 3. Integrated Commit Range

The user-first chain is 18 commits, from `a7804424` through `6043a937`, based on original user-first base `4efa89a9944561ad4f57b37d57f115fd78f7f43f`. It includes PR-01 through PR-09 and the associated review, gate, and visual-audit documentation. The PR-09 source branch is an ancestor of the integrated chain.

## 4. Explicitly Excluded PR-10 / PR-11

- PR-10 branch `codex/user-first-pr10-lazy-tts-foundation` (`6337d5fa`): excluded.
- PR-11 branch `codex/user-first-pr11-lazy-tts-runtime` (`22fc3058`): excluded.
- Candidate commits `aa938659` and `1faa4218` are not ancestors of `dev-02`.
- No PR-10/11 cherry-pick, merge, or code copy was performed.

## 5. Git Integration Strategy

Created `dev-02` from the exact local `dev` HEAD, then merged the final PR-09 chain once. This preserves the 18 meaningful commits and adds one integration merge commit, `f83c8f3d`. PR-10/11 remain on their feature branches.

## 6. Conflict Resolution

There was one add/add conflict in `docs/reviews/user-first/frontend-design-baseline.md`. After comparing the substantive document content, it was identical; the `dev` copy was retained. The separate `frontend-user-first-delta.md` was preserved. No runtime source conflict was found. `git diff --cached --check` passed before the integration commit.

## 7. Final Runtime Architecture

No application source was changed during integration. The integrated runtime retains the user-first domain boundaries: `ReadingWork`, `ReadingPart`, `ReadingState`, `ContentAsset`, and `Conversation`; explicit Library membership remains distinct from reading progress and history; Personal Work ownership and Catalog visibility remain separate. Legacy `/my-shelf` and `/api/shelf` are not restored. User TTS settings persistence exists, while Reader-side user-specific synthesis remains deferred.

## 8. Migration Verification

The pending migrations were applied successfully to the verified `gloaming_test` database. Migration `0036` is present in the PR-01–PR-09 chain. A read-only aggregate query after migration returned 0 `reading_state` rows and 0 `user_library_item` rows, so this database did not exercise a non-empty historical backfill. No production or development database was migrated. Historical membership semantics remain a product/data decision; no membership rows were deleted.

## 9. Application Startup

- Web: Started at `http://localhost:3000`.
- Backend: Started at `http://localhost:3333` and connected to `gloaming_test`.
- Worker: Started against the same test database and an isolated Redis DB index.
- PostgreSQL: Existing local container was healthy and reachable.
- Redis: Existing local container was healthy and reachable.
- Object storage: No local compatible storage service was started or validated. Upload-to-storage acceptance was not run.

A first Worker run against the default test Redis index found stale cleanup jobs left by earlier test activity. It was stopped without flushing or deleting those jobs; the runtime was restarted on an isolated Redis DB index.

## 10. Library Acceptance

The `/library` route returned HTTP 200. The unauthenticated browser showed the login dialog and the expected Library route title. The authenticated Library empty/list states, EPUB upload, processing and failure states, Catalog removal confirmation, and Personal Work to Reader flow were not visually verified. Backend and web automated suites passed, but they do not replace those browser checks.

## 11. Settings Acceptance

The `/settings` route is included in the build and its web tests pass. Authenticated Settings UI, provider/model edits, key masking, default-provider states, mobile layout, and dark mode were not visually verified.

## 12. Reader Acceptance

Reader route and behavior are covered by automated web/backend tests. No authenticated browser Reader session was available, so Personal Work reading, progress persistence, and History continuation were not manually verified in this gate.

## 13. Admin Acceptance

Admin Catalog, configuration, and log routes are present in the successful build. Admin browser access and Catalog workflows were not verified. The stale `/admin/works` URL returned 404 as expected; it was not restored as an alias. Automated backend coverage includes the relevant admin/provider flows.

## 14. Provider Runtime Acceptance

Provider resolver and scope tests passed as part of the full backend suite. No paid AI request was made. Settings-to-live-AI behavior was not manually exercised in the browser. GitNexus was unavailable for authoritative impact review: its index was stale and refresh failed with a local registry permission error; source and call-site review remains the fallback.

## 15. TTS Known Deferred Capability

- Admin TTS diagnostic remains Instance-only; its automated coverage passed.
- User TTS settings and credential persistence are implemented, with masking coverage in automated tests.
- Reader-side User TTS runtime, cache isolation, and BYOK cost semantics remain **Deferred to the post-Integration Lazy TTS Epic** (`R2-001`). This is not marked resolved and is not a blocker to integration itself.
- No Lazy TTS work was started.

## 16. Work Access / Security

The full backend suite passed, including work-access and provider-scope coverage. Production data was not accessed. Browser-level owner/non-owner/anonymous isolation was not manually executed in this gate.

## 17. Visual Acceptance

- `FRONTEND-VISUAL-001` (Library): **Pending**.
- `FRONTEND-VISUAL-002` (Settings/BYOK): **Pending**.
- Desktop screenshots showed the public home page. Required authenticated, mobile, empty, upload, removal, theme, and settings states were not captured.

## 18. Anti-AI UI Runtime Audit

The public home page rendered at desktop size with a restrained editorial layout. The `/discover` route loaded with HTTP 200 and its catalog API returned HTTP 200, but the browser showed a blank page after reload and no page content in the accessibility tree. This remains an unresolved runtime finding; no conclusion is made about the rest of the authenticated UI.

## 19. Full Regression

- Shared: 20 files, 155 passed.
- i18n: 2 files, 10 passed.
- Backend: 88 files, 592 passed, 1 skipped. Initial attempt lacked `RESEND_API_KEY`; rerun with a test placeholder passed. Provider rejection logs occurred; delivery was not established.
- Web: 48 files, 245 passed.
- Typecheck: all workspace packages passed.
- Backend build: passed.
- Web build: passed with `API_INTERNAL_URL=http://localhost:3333`; build listed 26 routes, including `/library`, `/settings`, and `/admin/catalog/works`, with no `/my-shelf` route.
- ESLint: 0 errors; 1 existing `<img>` performance warning at `apps/web/features/admin/works/works-preview-page.tsx:21`.
- No repository-wide `verify` / `test:all` entry point was found; component suites, typecheck, lint, and builds were run separately.

## 20. E2E

No Playwright/Cypress browser E2E harness was found. No dependency or large test system was added. Manual browser checks confirmed the public home page, the Library login dialog, the stale-route 404, and the blank Discover rendering. The required authenticated flows — Personal EPUB upload to Reader, Discover save/remove, Settings-to-AI, and browser access isolation — remain unverified. Functional/integration test coverage passed but is not reported as E2E.

## 21. Legacy Audit

The post-merge source search found no active `/my-shelf`, `/api/shelf`, `/admin/works` or `/api/admin/works` compatibility route, `requirePublished*` helper, or legacy `processing_status` assignment to `published`/`tts`. Old route strings remain in negative tests and historical/review documentation. `getPublishedWork` is Catalog detail naming, not a legacy `getPublished` helper. No legacy runtime was reintroduced.

## 22. Decision Watchlist

- `R2-001`: Deferred to post-Integration Lazy TTS Epic; not resolved.
- `PR05-HISTORY-001`: Open. Migration `0036` backfills each historical `reading_state` row into `user_library_item`, but this test database had no rows to measure. Potential effect: historical reads may appear as saved Library entries; no cleanup was performed.
- Other product decisions in the existing watchlist remain open. No migration semantics or product decisions were changed here.

## 23. Integration Bugs Fixed

None. The blank Discover runtime remains unresolved and is recorded as a blocker for further refactoring.

## 24. Remaining Blockers

1. Reproduce and diagnose the blank `/discover` page despite successful route and catalog API responses.
2. Provide a safe authenticated test session and isolated object storage to verify Library, upload, Reader, Settings, and Admin browser flows.
3. Complete required mobile/dark visual states and the minimal core E2E scenarios.
4. Keep `FRONTEND-VISUAL-001/002` pending until those checks pass.

## 25. Next-stage Recommendation

Do not start post-integration refactoring yet. First resolve the Discover rendering issue, then rerun browser acceptance with an authenticated test user and isolated storage. Keep `R2-001` deferred; do not start Lazy TTS or Architecture Subtraction in this gate. PR-10/11 can be reassessed only after the integration baseline is accepted.

## 26. Final Gate Status

- Integration Gate #1: **Failed**.
- Can post-integration refactoring continue: **No**.
- Can `dev-02` merge to `dev`: **No**.
- Production DB touched: **No**.
- `dev` branch modified: **No**.
- PR-10/11 merged: **No**.
- Cursor used: **No**.

## Closure Run — 2026-09-29

This run preserves the original failed result above. It is a verification follow-up, not a new integration or architecture phase.

### Git and runtime changes

- Starting HEAD: 682de15376d498be804de54a15873954aa43e218 on dev-02.
- The primary dev checkout remained at a177dc2040738d0f9a3a49e7f2b047d946513c1c and was unchanged.
- PR-10 candidate aa938659 and PR-11 candidate 1faa4218 are not ancestors of dev-02.
- No runtime fix or regression test was added: this run did not reproduce a JavaScript exception or establish a deterministic code defect.

### Discover reproduction

- A fresh browser context opened /discover directly. The route returned 200 and initially showed the full-page loading view; the catalog appeared after roughly 20 seconds. The longer-than-expected cold-start wait was not explained.
- On the warmed page, hard reload rendered the Discover heading, tag filter, and Catalog item within about 2.5 seconds. Navigation from the home page also rendered the same content.
- Selecting the available tag and opening the mobile filter dialog both worked.
- Browser console observations contained the unauthenticated GET /api/library 401; the page still rendered. No React exception or hydration error was observed. Backend logs showed Catalog list/taxonomy responses succeeding. This confirms the 401 is handled in the observed session, but does not identify the original blank-page cause.
- Source review confirms AppShell returns GlobalLoading while authClient.useSession().isPending. That explains the loading view, but the unusually long first wait and the earlier Gate screenshot remain unexplained. The original finding is therefore **not resolved**.
- No standalone Network-panel capture of every RSC/chunk request was available in this run; no claim is made that every requested network diagnostic was independently inspected.

### Environment and authenticated journeys

- Web and Backend were running locally; Backend was connected to gloaming_test. PostgreSQL and Redis were reachable. The test Redis DB was isolated from the running app's Redis DB.
- No Worker was started for this closure run. The configured object-storage destination is a non-local, test-named bucket and has no production marker, but connectivity and upload were not exercised.
- No browser test users were established. The configured test mail key is a placeholder and the auth mail provider rejected delivery in the full test suite. The app has no verified local mail catcher available in this checkout. No auth bypass was introduced.
- Personal EPUB Upload → Library → Reader: **Blocked** — no browser session; Worker/storage upload not exercised.
- Continue Reading and Reading History: **Blocked** — no authenticated browser session.
- Discover → Add and Remove from Library: **Blocked** — no authenticated browser session.
- User A / User B work-access isolation: **Blocked** — no authenticated browser sessions.
- Settings and secret masking: **Blocked** — no authenticated browser session.
- Admin Catalog routes and publish/unpublish: **Blocked** — no admin browser session.

### Visual review

- FRONTEND-VISUAL-001: **Pending**. Library authenticated, upload, removal, empty, and dark states were not reviewed.
- FRONTEND-VISUAL-002: **Pending**. Settings and its AI/TTS states, key masking, mobile, and dark mode were not reviewed.
- Discover: desktop and 390×844 mobile views rendered; the tag filter and mobile filter dialog worked. Dark mode was not verified. The available test Catalog item's cover area was blank; no design change was made based on that fixture.
- Anti-AI runtime audit is limited to the public Discover view: its restrained book-oriented layout did not show a dashboard or nested-card pattern. This is not an acceptance of the unobserved authenticated UI.

### Regression

- Backend: 88 files, 592 passed, 1 skipped.
- Web: 48 files, 245 passed.
- Shared: 20 files, 155 passed.
- i18n: 2 files, 10 passed.
- Workspace typecheck: passed.
- Backend build: passed. Web build: passed with local API_INTERNAL_URL=http://localhost:3333.
- ESLint: 0 errors; 1 existing <img> performance warning in apps/web/features/admin/works/works-preview-page.tsx:21.
- The first Backend test invocation lacked the required placeholder env and failed during configuration. The rerun with RESEND_API_KEY=re_test_placeholder passed; test-only verification-email submissions were rejected by the provider and did not establish delivery.

### Deferred scope and gate result

- R2-001 Lazy User TTS Runtime remains deferred; no Lazy TTS work was continued.
- PR05-HISTORY-001 remains an open product/data decision; no non-empty migration backfill was constructed.
- Personal Work Delete remains unimplemented and outside this Gate repair.
- Architecture Subtraction was not started.
- Integration Gate #1 remains **Failed** because the initial Discover blank/loading finding is unexplained and authenticated Library, Reader, Settings, Admin, storage, and visual acceptance remain incomplete.
- Can post-integration refactoring continue: **No**.
- Can dev-02 merge to dev: **No**.
- Push / merge / PR creation: **None**. Production DB touched: **No**. Cursor used: **No**.
