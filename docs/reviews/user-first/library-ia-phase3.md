# Library IA Phase 3 — IA-04 User Tags

## Git Baseline

- Branch: `dev-02`
- Starting and final HEAD: `6104d34de455e6b4a7adb41a4bad811c46bf1437`
- The working tree was already dirty with IA-01/02/03, `DESIGN.md`, product documents, `skills-lock.json`, and three deleted `pi-delegate` files. These were preserved. Nothing was committed, pushed, reset, cleaned, stashed, or moved to a worktree.

## Existing Tag Capabilities

- **Already present:** private User Tag CRUD APIs, duplicate-name checks, per-user ownership checks, API-provided association counts, assignment/removal, saved Catalog access checks, and cleanup of tag associations on deletion.
- **Already present:** Library sidebar tag selection and quick creation, the Tag Management page, book management menus and a shared tag assignment dialog, URL-backed source/tag filtering, and return-to-Library context.
- **Missing:** Tag names and counts on the Tag Management page did not navigate to that tag’s Library results. Tag mutations did not invalidate every affected Book Detail cache. A partial multi-request assignment failure could leave cached views stale.
- **Repaired:** Tag name/count now links to a stable tag-ID filter while preserving source and unrelated query parameters. Tag management and assignment refresh Library, tag, and relevant Book Detail queries on success; assignment also refreshes after an error so any successful partial requests become visible. Removed the redundant Tag Management explainer and its locale entries.

## Implementation

- **Library Sidebar:** Existing source/tag navigation and inline tag creation remain in place. No new tag domain or CRUD surface was added.
- **Tag Management:** Existing create, rename, and confirmed delete controls remain. A tag’s name/count links to its filtered Library results. The validated `returnTo` source context is preserved.
- **Book Card:** Existing management menu provides the shared Manage Tags entry.
- **Book Detail:** Existing shared tag management entry remains available; tag changes now invalidate the matching detail query.
- **Tag Association:** Existing dialog supports selecting/removing tags and creating a tag for the current book. Success and error paths refresh visible tag-related queries.
- **URL State:** Tag navigation uses the stable tag ID, preserves source filters and unrelated query parameters, and uses the existing safe return URL resolution. No tag name is used as identity.

## Data Safety

- **User Isolation:** Existing API derives the tag owner from the authenticated user and scopes tag queries/mutations by that user. Functional API coverage exercises cross-user isolation.
- **Work Access Policy:** Existing backend permits assignment to an owner’s Personal Work or a saved, published Catalog Work; it rejects another user’s Personal Work and unsaved Catalog Work. No access policy was changed.
- **Delete Semantics:** Existing backend deletes the User Tag and its associations. Functional tests verify the Work remains.
- **ReadingState Preservation:** Added a functional assertion that deleting a tag leaves the associated `in_progress` ReadingState intact.
- No schema, migration, production database data, user account tag, or Gutenberg data was changed.

## Tests

- **Targeted Tests:** `apps/backend/tests/functional/domains/library/user-tags.spec.ts` — 1 file, 3 tests passed against the isolated `gloaming_test` database. Coverage includes user/work access boundaries, rename preserving a live association and accurate count, and deletion preserving Work and ReadingState.
- **Web Tests:** `pnpm --filter @gloaming/web test` — 43 files, 248 tests passed.
- **i18n Tests:** `pnpm --filter @gloaming/i18n test` — 2 files, 9 tests passed.
- **Typecheck:** `pnpm typecheck:web` and `pnpm --filter @gloaming/backend typecheck` passed.
- **Lint:** `pnpm lint:web` and `pnpm --filter @gloaming/backend lint` passed.
- **Prettier:** `pnpm exec prettier --check` for the six changed source/test/locale files and this report — PASS. One formatting issue in `library-page.spec.ts` was corrected, then the full changed-file check passed.
- **Diff Check:** `git diff --check` — PASS after all edits.

## Browser Verification

- **Desktop:** BROWSER VERIFIED. The signed-in in-app browser showed Library with Continue Reading, the filtered Personal Works grid, card management menus, and the Tag Management route. It returned to `/library?source=personal` with the source filter intact.
- **Mobile:** BROWSER VERIFIED at 390px and 375px viewport overrides. The source/tag drawer, Manage Tags entry, tag empty state, and full-width create control were visually inspected. The viewport override was reset afterward.
- **Theme and language:** Light and dark appearances, and Simplified Chinese and English labels, were inspected in the in-app browser. The browser was restored to Simplified Chinese and light appearance.
- **Book Detail:** The existing Personal Work detail and its Manage Tags dialog were opened. The Reader CTA remained present. No tag was selected or saved.
- **Create / Rename / Associate / Filter by an existing tag / Remove Association / Delete:** NOT VERIFIED against the user account. It had no tags, and this task explicitly forbids creating permanent account data without approval. API and UI behavior is covered by automated tests where noted, but that is not a real-account browser pass.
- **Saved Work:** A positive Saved Catalog sample was not available in the account, so its browser path is NOT VERIFIED. Backend automated tests cover access policy for saved and unsaved Catalog Works.
- No visible error toast or broken page state was observed during the inspected paths.

## UI/UX Review

- **Self-Explanatory UI:** Existing visible names, association counts, create control, and management actions communicate the flow without requiring a help paragraph.
- **Redundant Copy:** Removed the repeated explanatory sentence from Tag Management.
- **Action Discoverability:** Tag selection and creation remain in Library; lower-frequency rename/delete remain on Tag Management; per-book association remains in the shared book-management dialog.
- **Paper-First Consistency:** Existing semantic theme tokens and typography remain in use. No visual system or unrelated page layout was changed in this phase.

## Known Limitations

- **IA-02 Watchlist:** IA-02 remains PARTIAL as recorded in its phase report; IA-04 did not expand its scope.
- **IA-03 Remaining Gaps:** Search, sorting, list view, complete server-side filtering, and pagination remain later work.
- **48-item Limit:** Library still filters only the currently loaded items (up to 48). The API-provided tag association count is used instead of inferring a count from that truncated list. Complete large-library search is not solved here.
- **Saved Work Verification:** No saved Catalog sample was available for positive browser verification.
- **Tag name normalization:** `normalizeTagName` removes every non-ASCII letter/digit whenever any ASCII character remains. Mixed CJK/ASCII names can therefore collide or evade duplicate detection (for example, distinct CJK names ending in the same digit normalize identically, while a future CJK-preserving normalization would need to reconcile existing stored `normalized_name` values). This was confirmed in source; no normalizer or persisted values were changed because safe compatibility may require a data migration, which is outside this phase’s authorization.
- **Partial assignment requests:** Assignment is issued as multiple requests rather than one atomic operation. The UI now invalidates views on failure so successful sub-requests are reflected, but atomic all-or-nothing assignment remains unimplemented.

## Git Status

- Final HEAD remains `6104d34de455e6b4a7adb41a4bad811c46bf1437` on `dev-02`.
- IA-04 changes and this report remain uncommitted. Existing IA changes, the three `pi-delegate` deletions, and `skills-lock.json` remain untouched.
- No push, migration, Gutenberg sync, service restart, or account tag mutation occurred.

## IA-04 Status

**PARTIAL** — the identified interaction/cache gaps are repaired and automated checks pass. Desktop/mobile layouts and read-only account paths were inspected in the in-app browser. Real account CRUD and tag-filter paths remain unverified because the account has no tags and no permanent test tag was created. Mixed CJK/ASCII tag-name normalization also remains a confirmed data correctness limitation for a separately authorized compatibility-safe fix.
