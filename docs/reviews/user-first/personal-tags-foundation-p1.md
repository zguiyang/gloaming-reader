# Personal Tags Foundation P1

**Status:** Implemented; desktop internal-browser acceptance completed. Narrow viewport review and saved screenshot artifacts remain outstanding. No commit or push was made.

## 1. Scope

Implemented private Personal User Tags with Unicode-safe per-user uniqueness, localized names, manual create/edit, optional AI translation completion, missing-translation fallback, and protection for user-edited values. Existing Library Sidebar, Tag Management, and Book Manage Tags Dialog remain the entry points.

No public categories, global Taxonomy, upload-time AI organization, automatic tag association, Discover/SourceRecord changes, vector search, or hierarchy were added.

The three requested corrections were made in `ai-labeling-contract.md` without rewriting the draft: Case 16 has no one-concept first-run cap; the historical three-tag limit is attributed to the old public-work AI Metadata flow and is not presented as personal auto-organization acceptance; and test database isolation is scoped to automation and agent writes, not future explicitly approved development migrations or normal business validation.

## 2. Schema changes

Migration `0045_stiff_oracle.sql` adds three nullable/defaulted fields to `user_tag`:

| Field                            | Purpose                                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `source_locale`                  | Locale of the original user-entered name. Existing rows remain `NULL` because their language is unknown. |
| `localized_names` (`jsonb`)      | Names keyed by supported locale. A missing key means untranslated.                                       |
| `user_edited_locales` (`text[]`) | Locales explicitly written by the user; AI completion must preserve these values.                        |

The existing `name` and `normalized_name` fields remain for the User Tag API's existing `name` contract and unique key. The unique constraint remains `(user_id, normalized_name)`, so names are unique per user and different users may use the same name. Tag IDs and `user_work_tag` references do not change. The migration recalculates existing normalized keys with the new rule after a collision preflight; it fails without deleting or merging rows if names collide under that rule.

API responses retain `id` and `name`, and add localization metadata. Existing payloads without the new response fields still parse through shared-schema defaults. Create and rename requests keep `name`; `locale` is optional for older callers and defaults to `DEFAULT_LOCALE`. The new translation-completion route is owner-authenticated.

## 3. Unicode name rules

Names are trimmed and validated as non-empty, at most 80 UTF-16 code units; control characters and bidi override/isolate controls are rejected. Uniqueness keys use Unicode NFC, collapse the ECMAScript Unicode whitespace set, then locale-independent Unicode lowercase (`toLocaleLowerCase('und')`). Migration 0045 uses the matching Unicode whitespace set and PostgreSQL ICU `und-x-icu` lowercase. Punctuation is retained, so `C++`, `C#`, `.NET`, `AI/ML`, and `AI ML` remain distinct. Canonically equivalent spellings normalize to one key. The rule distinguishes `英语学习2` from `儿童文学2`.

This is exact text normalization only. It does not infer language similarity or merge labels across users. Manual labels have no AI semantic-quality gate.

## 4. Localization storage and fallback

`localized_names` stores only values actually entered or returned as a valid translation. New tags store the user's input under the selected `SUPPORTED_LOCALES` locale. Legacy tags retain their original `name`, have unknown `source_locale`, and start with no claimed translations.

Display resolves the requested locale first, then falls back to the original `name`. The UI separately shows missing supported locales, so the fallback is not represented as a completed translation. AI completion will not run for a legacy tag whose source locale is unknown; the user can assign a locale while editing it.

## 5. Manual edit protection

User edits atomically set the localized JSON value and add that locale to `user_edited_locales`. AI updates each candidate locale only if the key is still absent, the locale is not user-edited, and the source locale/name still match the values used for that request. This conditional database update protects both target edits and source edits made while an AI call is in flight. When the source name actually changes, the same update removes automatic translations while preserving all manually edited locales. The legacy `name`/`normalized_name` fields update without changing the tag ID or associations.

## 6. Provider Resolver reuse

Translation calls use the existing `invokeAi` entry point with `purpose: 'translate'`, the authenticated `userId`, and a `user_tag` reference. This reuses current user-scoped Provider Resolver/BYOK selection and invocation logging. It does not read the auto-organization setting or add Provider configuration.

The tag is saved before translation is requested. Translation runs as a separate client request, so an unavailable Provider, invalid/failed model response, or request failure leaves the tag and original name intact. Only supported, requested locale results that pass basic name validation are saved. A same-spelling value explicitly returned for a requested target is accepted as a confirmed translation; a locale omitted from the response remains missing and falls back to the original name only for display. Automated coverage mocks `invokeAi`; no real model was called.

## 7. Frontend interaction

- Library Sidebar creation saves the current UI locale and starts translation completion without waiting to save the tag.
- Book Manage Tags Dialog keeps create-and-assign behavior and starts translation after the tag is created and associated.
- Existing Tag Management lists names by supported locale, marks missing names, lets the user edit any supported locale in place, and offers a contextual “Complete names” action.
- Localized display uses the same fallback in Library filters and tag assignment.
- Chinese and English messages were added for completion and missing-Provider states; all visual styling uses existing semantic tokens.

## 8. Automated verification

| Check              | Result                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Backend full suite | Passed: 101 files passed, 1 skipped; 627 tests passed, 2 skipped. User Tag AI behavior used a mock.                                    |
| Web full suite     | Passed: 43 files, 248 tests.                                                                                                           |
| i18n full suite    | Passed: 2 files, 9 tests.                                                                                                              |
| Typecheck          | Passed across shared, i18n, DB, backend, and web.                                                                                      |
| Prettier           | Passed path-scoped check for changed source, locale, and P1 report files. The pre-existing review draft was not reformatted wholesale. |
| Lint               | Passed after correcting import ordering and removing one unused test import.                                                           |
| `git diff --check` | Passed.                                                                                                                                |

The test database migration was applied only to the verified isolated `gloaming_test` database. The first attempt exposed that the existing unique index is constraint-owned; the SQL was corrected, validated in a rolled-back test-database transaction, and then applied successfully. No development or production migration was run.

## 9. Remaining work

- Narrow/mobile viewport review remains necessary. Desktop internal-browser review covered Chinese Light and English Dark, locale switching, manual translation editing, missing-name feedback, translation fallback, and create/rename/delete flows.
- Development database migration and normal business validation remain for a later explicitly authorized step.
- Existing tags with a null source locale need a user locale assignment before AI completion can translate them.
- Current uniqueness is enforced on each tag's primary/original `name`; translated aliases are not a second global uniqueness index.
- Translated aliases have no uniqueness check: two same-user tags may display the same localized name. This is the current requested behavior; a product decision would be needed before adding a policy or automatic merge.

## 10. Git state and handoff

Branch remains `dev-02`. No commit, push, branch switch, worktree, reset, clean, or stash was used. Initial user changes remain: the three deleted project-local `pi-delegate` files, modified `skills-lock.json`, and pre-existing untracked review documents. P1 implementation and this report are additional working-tree changes.

## Acceptance summary

- **Implemented:** Unicode normalization, locale-aware create/edit, AI translation completion and manual retry, missing-name fallback, edit protection, stable IDs, per-user ownership, and existing UI integration.
- **Automated acceptance:** backend, web, i18n, and typecheck passed as recorded above; AI behavior was mock-only.
- **Real browser acceptance:** still required for bilingual light/dark interaction and responsive layout.
- **Database migration:** required for any environment using this schema. It was applied to `gloaming_test` only; development and production remain untouched.
- **Before P2 AI auto-tagging:** decide the opt-in control and disable semantics, removed-association suppression persistence, budget/concurrency/retry limits, and AI-field provenance. Then implement a separate authenticated Personal EPUB path that uses only the user's tags, validates ownership and associations, is idempotent, preserves manual edits, and degrades without blocking upload or reading. No P2 work was started.

## Final Acceptance Review

### 1. Review scope and browser

The in-app browser was used at `http://localhost:3000` with a synthetic account and two fictional Personal Works in `gloaming_test`. No local Chrome session was used. The desktop UI was checked in Chinese Light and English Dark. The locale switch changed visible navigation and page copy. The narrow/mobile viewport could not be selected through the available in-app browser controls, so responsive acceptance remains open.

### 2. Manual UI scenarios

- Created a Chinese `科幻小说` tag. The UI confirmed creation and displayed that English was missing. With no configured test Provider, it retained the tag and showed the available-Provider prompt; no model was called.
- Edited the English name to `Science fiction`, then renamed the Chinese source to `星际科幻`. The English edit remained and the tag URL kept the same ID with one associated book.
- Created `AI/ML` in the English interface. The label and punctuation were preserved, while the Chinese name remained explicitly missing.
- Deleted the associated test tag through the confirmation dialog. The UI warned that only the tag would be deleted. Both fixture works remained in Library, and the reading fixture remained in Reading history.
- Automated tests cover successful AI completion, Provider unavailable, failure fallback, manually edited target protection, delayed response protection, retries without duplicate tags, per-user ownership, same-user uniqueness, and Unicode normalization. Those AI cases use mocks only.

### 3. Screenshots and narrow viewport

The in-app browser displayed screenshot captures of the Chinese Light Reading history and English Dark Tag Management states during review. The available in-app browser screenshot action returns an image to the conversation but exposes no save-to-workspace operation. Therefore no PNG files were written under `docs/reviews/user-first/screenshots/personal-tags-p1/`; saving the requested screenshot artifacts and checking the narrow/mobile layout still need completion with a supported internal-browser export/viewport control.

### 4. Test and formatting results

- Targeted User Tags backend tests passed after the final Unicode and race-condition changes: 2 files, 11 tests. Full backend suite passed: 101 files, 630 tests; 1 file and 2 tests skipped.
- Web tests passed: 43 files, 248 tests.
- i18n tests passed: 2 files, 9 tests.
- Typecheck and lint passed.
- Prettier passed for the changed application/schema/locale/report files after formatting the touched service and contract. The repository-wide `pnpm format:check` failed because 109 repository files, including pre-existing `.agents` skill copies and review documents, are not formatted. Prettier has no parser for the raw SQL migration, which was excluded from the path-scoped check.
- `git diff --check` passed.

The internal browser's Next.js development overlay also showed duplicate React keys for the two synthetic Library fixtures. This was limited to the fixture listing and did not affect tag creation, editing, association, or deletion; no unrelated Library rendering change was made in P1.

### 5. Database and migration

The browser fixture and automated functional tests used only `gloaming_test`. Migration `0045_stiff_oracle.sql` had already been applied to that isolated test database earlier in P1. This final review did not apply a migration. The migration remains required for development or production when separately approved; no development or production database was migrated.

### 6. Remaining acceptance and next phase

- Save the captured Chinese Light and English Dark screenshots into the requested screenshot directory, then review mobile/narrow layout in the internal browser.
- No live Provider/paid model acceptance was performed; mocked translation tests are not model-quality evidence.
- P2 still requires explicit user opt-in and disable semantics, persistence for manually removed associations, bounded retries/concurrency/cost, provenance and conflict rules, then a separate authenticated Personal EPUB implementation using only user-owned tags. No P2 work was started.
- Branch remains `dev-02`; no commit, push, branch change, reset, clean, or stash was performed.
