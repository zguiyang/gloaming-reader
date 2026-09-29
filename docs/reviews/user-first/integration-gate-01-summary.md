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

## Environment Closure Run — 2026-09-29

This run follows the prior Initial Run and Closure Run without replacing either record. It closes the local auth-account and test-storage setup where possible; it does not start a new feature phase.

### Git and tooling

- Branch: `dev-02`.
- Starting HEAD: `c63ac025e1910758fc638f2c815a9b94f0a26885`.
- Primary `dev` remained at `a177dc2040738d0f9a3a49e7f2b047d946513c1c` and was not modified.
- PR-10 (`aa938659`) and PR-11 (`1faa4218`) are not ancestors of `dev-02`.
- Added and committed the local-only account bootstrap as `1f574196` (`test(auth): add local integration gate user bootstrap`). No runtime code or package configuration changed.
- GitNexus reported its index stale at `81d92f1`; its uncommitted-change scan returned no symbols for the untracked file. The graph result is not treated as an all-clear. Manual source review found the addition is isolated to a Vitest spec and uses existing Better Auth test conventions; Backend Full, typecheck, lint, and build passed.
- No PR was created, and no push or merge was performed.

### Auth environment

- No existing local mailbox, fake mail provider, or persistent browser-user tool was found. Existing functional tests provide the safe pattern: mock auth mail, register through the normal Better Auth endpoint, mark only the test-database user verified, then use normal sign-in.
- Added `apps/backend/tests/functional/tools/gate-test-users.spec.ts`. It is skipped unless `GLOAMING_GATE_BOOTSTRAP_USERS=1`; when enabled it hard-fails for `NODE_ENV=production`, requires `DATABASE_URL` to equal `TEST_DATABASE_URL`, and permits only database `gloaming_test`. It uses normal sign-up/sign-in, mocks auth mail, assigns the admin role only in the test database, and writes random credentials to a new file under `/private/tmp` with mode `0600`.
- The explicit bootstrap run created two verified user accounts and one role-backed admin account. Each account obtained a Better Auth session cookie and returned HTTP 200 from `/api/auth/get-session`. No password or token is recorded here. Credentials are retained locally at `/private/tmp/gloaming-gate-users-1790673352388.json` for the user-directed browser follow-up.
- This verifies the test harness session endpoint, not browser reload persistence, browser logout, or browser re-login. Those remain unverified.
- The bootstrap mock prevented mail-provider calls. Backend regression used an invalid Resend test placeholder; the provider returned validation errors, and no mail delivery was established.

### Storage environment

- The configured provider is Cloudflare R2-compatible. The `.env.test` bucket is test-named, differs from the development bucket, and has no production marker. The endpoint matched the configured R2-compatible service.
- A random object under an `integration-gate-01/` run prefix passed `put`, HEAD, read-back, and delete checks using the repository object-store interface. A final HEAD confirmed that the object was absent.
- Production storage was not used.

### Browser journeys and visual acceptance

- No Web/API/Worker listener was running at the start of this run. The repository `AGENTS.md` prohibits starting `dev:*`, `start`, or `preview` services. The browser runtime therefore was not started through an equivalent command.
- Personal Upload → Processing → Ready → Library → Reader: **Blocked** — real browser journey not run.
- Invalid EPUB failure state and Library usability after failure: **Blocked** — real browser journey not run.
- User A / User B personal-work access isolation: **Blocked** — real browser sessions not run.
- Discover → Book Detail → Add to Library; Remove with preserved progress/history; Continue Reading; Reading History: **Blocked** — real browser journeys not run.
- Settings CRUD, secret masking in Network responses, and AI/TTS states: **Blocked** — real browser journey not run. Existing automated suites remain supporting evidence only.
- Admin routes and publish/unpublish UI: **Blocked** — real browser journey not run. Existing automated admin coverage remains supporting evidence only.
- `FRONTEND-VISUAL-001` (Library): **Pending**.
- `FRONTEND-VISUAL-002` (Settings): **Pending**.
- Desktop/mobile/dark-mode authenticated states and the anti-AI runtime audit were not observed in this run.

### Discover loading observation

- Three cold direct `/discover` measurements were not performed because the local application runtime was not started. Session-pending duration, catalog request duration, and first visible content time: **NOT MEASURED**.
- The earlier one-off loading and blank-screen observations remain historical. This run did not reproduce a persistent blank page or establish a runtime exception. The blank-screen symptom is **not reproducibly confirmed as a runtime defect**; no loading change was made.

### Regression

- Backend Full: 88 files passed, 1 skipped (89 total); 592 passed, 2 skipped. The additional skipped test is the opt-in local account bootstrap.
- Web Full: 48 files, 245 passed.
- Shared Full: 20 files, 155 passed.
- i18n Full: 2 files, 10 passed.
- Workspace typecheck: passed.
- Backend build: passed. Web build: passed with `API_INTERNAL_URL=http://localhost:3333`.
- ESLint: 0 errors; 1 existing `<img>` warning at `apps/web/features/admin/works/works-preview-page.tsx:21`.
- Prettier check for the new tooling and `git diff --check`: passed.

### Closure result and remaining blockers

- Auth and storage environment setup: **Closed** for test-only account creation and isolated object-store connectivity.
- Authenticated browser journeys, user isolation, Settings/Admin visual checks, three cold Discover timings, and FRONTEND-VISUAL-001/002 remain **Blocked/Pending**.
- Integration Gate #1: **Failed**. The required browser acceptance has not been performed.
- Can post-integration refactoring continue: **No**.
- Can `dev-02` merge to `dev`: **No**.
- Production DB touched: **No**. Production storage touched: **No**. `dev` modified: **No**.
- PR-10/11 merged: **No**. Lazy TTS continued: **No**. Architecture Subtraction started: **No**. Cursor used: **No**.

## Real Auth Acceptance Run — 2026-09-29 (In Progress)

This is the latest continuation of Gate #1. It preserves the Initial Run, Closure Run, and Environment Closure Run above. No application source or package configuration was changed.

### Baseline and local runtime

- Branch: `dev-02`; starting HEAD: `fdc489b249eaee86835c80b1e40556f7686daaad`; worktree was clean.
- Web and Backend listeners were present on ports 3000 and 3333. PostgreSQL and Redis container ports were present on 5433 and 6380. The browser completed authenticated requests through the Web application. Worker readiness and backend health endpoints were not independently verified in this run.
- The active Backend `.env` targets local `127.0.0.1:5433/gloaming_backend` and bucket `gloaming-development`. `.env.test` targets `gloaming_test` and bucket `gloaming-test`. The upload Gate requires the isolated test bucket; no object-storage write was attempted while the running Backend pointed at the development bucket.
- Production database and production storage were not accessed.

### User and Auth audit

- The development database had been reset and migrated in the prior authorized environment run. Before the user completed registration, the Auth tables were empty; no account data was cleared in this continuation.
- Current Auth schema in `packages/db/src/schema.ts` is `user`, `account`, `session`, and `verification`. The live database contains 1 user, 1 credential account, 3 session rows, and 0 verification rows. The account and session foreign-key checks found no orphan rows.
- The real registered user has `email_verified=true`, role `user`, one credential account, and no owned works, Library memberships, or reading states. Identity is omitted from this report. Current required fields and relations resolve through the live application.
- Login succeeded through the normal Web form. Refresh retained the authenticated session. Logout returned the browser to the public page; signing in again succeeded, and refresh retained the new session. No password, session token, or verification code is recorded.
- The supported `create:admin` command exists. Its implementation uses Better Auth signup, assigns the first Admin role only within the trusted transactional bootstrap, and creates an ordinary User identity with the `admin` role; this matches the current User-first model. It was not run because no separate Admin email/password was supplied. The real acceptance account remains a normal User.

### User A browser journeys

- `/library`: authenticated empty state rendered and the Upload EPUB entry was present. Upload, processing, failure, and Reader states were not exercised because the active Backend bucket did not meet the test-bucket precondition.
- `/discover`: the authenticated empty state rendered; the database has 0 `reading_work` rows. Three reload-to-accessibility snapshots completed in 305 ms, 215 ms, and 203 ms. Those snapshots initially exposed only the page heading; a subsequent screenshot showed the designed empty state. These were warm reload timings, not cold-start or first-content measurements. Catalog API response time and auth-pending duration were not measured. The earlier blank-page observation was not reproduced as a confirmed runtime defect.
- `/reading-history`: the designed empty state rendered; the account has no reading state or history.
- `/settings`: Default AI service and Default TTS source were visible. Own API mode showed no saved configuration and a disabled Save button. No provider, model, credential, or secret existed to test masking or Network response redaction; no settings were saved.
- `/admin/catalog/works`: the normal User received the explicit “no permission” page. Admin catalog, configuration, assets, logs, taxonomy, publish/unpublish, and Admin TTS flows remain unverified because no Admin account was created.
- Catalog Add/Remove, Continue Reading, Personal EPUB → Reader, progress/history preservation, and User A/User B isolation remain blocked by absent catalog/content data, the storage-target mismatch, and no User B account.

### Visual acceptance

- `FRONTEND-VISUAL-001` (Library): **Partial** — authenticated desktop empty state was viewed in light and dark modes; Upload control was present. Empty/normal distinctions beyond the empty state, processing, failed upload, Catalog removal, Personal Work, Continue Reading, and mobile remain unverified.
- `FRONTEND-VISUAL-002` (Settings): **Partial** — desktop Default AI and Default TTS states were viewed. Own API empty state was observed. Light/dark Settings comparison, mobile, saved provider/model forms, masked secret, and unavailable-provider states remain unverified.
- The original follow-system appearance preference was restored after light/dark inspection. Anti-AI review is limited to the observed empty states; it is not a complete authenticated UI audit.

### Remaining requirements and latest gate status

- User B registration and access isolation: **Blocked** — no second mailbox/verification was provided.
- Admin browser journeys: **Blocked** — the official compatible creation command requires a separate email and password.
- Test-bucket upload: **Blocked** — the running Backend uses `gloaming-development`; the Gate requires `gloaming-test`. No storage object was written.
- Mobile and authenticated visual states, valid/invalid EPUB flows, Catalog workflows, Reader progress, and full Settings/Admin acceptance: **Pending/Blocked**.
- `gate-test-users.spec.ts` disposition remains deferred until Gate closure.
- Integration Gate #1: **Failed / Incomplete**. Can post-integration refactoring continue: **No**. Can `dev-02` merge to `dev`: **No**.
- Production DB touched: **No**. Production storage touched: **No**. `dev` modified: **No**. PR-10/11 merged: **No**. Lazy TTS started: **No**. Architecture Subtraction started: **No**. Cursor used: **No**.
