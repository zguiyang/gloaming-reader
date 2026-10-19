# Personal Tags — Current Module Requirements

Owner of the **personal tag** module requirements: naming, translation, assignment, and deletion semantics for private per-user Library organization.

Related: [`mvp-scope.md`](./mvp-scope.md) · [`content-strategy.md`](./content-strategy.md) · [`public-categories.md`](./public-categories.md) · [`roadmap.md`](./roadmap.md)

## 1. Identity and scope

- Personal tags are **private per user**, **flat** (no hierarchy), with a **stable ID** that never changes on rename.
- Naming is **manual and free-form**, guarded by safety validation: trimmed, non-empty, bounded length; control characters and bidi override/isolate controls rejected.
- Same user: **primary name unique**. Different users: same names are **independent** (no cross-user sharing or merging).
- This module owns tag assignment and removal; the **book UI consumes** those methods. Tag management and book association have separate acceptance scopes.

## 2. MVP REQUIRED capabilities

- **Manual tag CRUD is MVP required.**
- **Name translation is MVP required** (not an optional feature).
- However, a **successful real AI call is not a prerequisite for manual persistence**: the manual tag is saved first; translation is requested separately afterward.

## 3. Name rules

- Uniqueness key: **Unicode NFC → whitespace collapse → lowercase**; **punctuation retained** (e.g. `C++`, `C#`, `.NET`, `AI/ML` stay distinct).
- Primary-name uniqueness applies **per user only**; cross-user identical names never collide.
- **Translated display names may collide** under the established P1 behavior. This does not authorize automatic merging or a new uniqueness policy.

## 4. Translation flow

- Manual create **saves the tag first**, then requests translation as a **separate, non-blocking step**.
- **Translation failure never blocks** the saved tag or reading.
- A **missing locale uses explicit fallback** to the original name; the UI marks the locale as untranslated rather than pretending it exists.
- **Manual locale edits are protected**: AI must not overwrite a locale the user edited.
- Manual translation passes the authenticated user to the existing **User → Instance → Unavailable** provider resolver. This differs from the automatic organizer's strict BYOK-only policy.

## 5. Deletion

- Deleting a tag removes **the tag and its associations only**.
- It **never deletes books or reading progress**.

## 6. Management surface

- Existing management UI: **`/library/tags`** (list, create, rename, per-locale edit, delete), plus book-side assign/unassign dialogs that call module methods.

## 7. Automatic organizer (P2)

- **Default OFF**; the user must **opt in**.
- When disabled, or the user's provider is unavailable, there is **no automatic tagging**.
- Automatic runs apply **only to future successful Personal EPUB parses after opt-in** — no automatic historical backfill.
- Toggling off/on advances a **generation**: stale-generation work is invalidated.
- Association caps: **automatic up to 3 (may choose 0); manual is unrestricted**.
- **Single-book reorganization is deferred** (no per-book re-run action).
- Provider resolution for automatic runs is **STRICT user-only BYOK** — never an instance fallback.
- **No daily business quota** (removed); engineering safeguards are retained: generation fencing, provenance, suppression of re-adding removed associations, and manual-protection guards.

## 8. Acceptance status (current)

- **Manual tag management (CRUD + localized names at `/library/tags`):** accepted in an earlier round; the previously listed "Next task" for it was stale and has been retired.
- **Tag-save partial-failure recovery:** accepted this round through targeted component tests only (no page re-acceptance, no real AI calls, no backend change): the save now waits for every assign/unassign request to settle before refreshing, giving feedback, and unlocking, so a fast failure alongside a slower success can no longer make the page diverge from persistent state or start a second save mid-flight; after refresh the persisted state becomes the diff baseline, and a retry sends only the still-missing changes. TDD evidence: the new race tests failed pre-fix against `Promise.all` (early refresh and wrong reopened-dialog baseline), then the full spec passed 40/40 with typecheck, lint, and format checks green.
- **Book association + Library tag filtering:** accepted this round (targeted component tests, backend functional tests, and interactive page acceptance on existing ready library books). Found and fixed a selection-sync defect: after "create and assign", the new tag stayed unchecked, and a subsequent Save wrongly unassigned the just-created association; the dialog now syncs the selection with the persisted association. Translation-completion requests were meant to be intercepted in the browser, but the embedded-browser route mock proved ineffective; two acceptance-tag creations therefore invoked the user's real provider before detection. No real-translation acceptance is claimed from this round; no further real calls were made, and all acceptance tags were removed afterwards.
- **Real AI translation + automatic P2 tagging: accepted with a bounded real BYOK sample (2026-10-19, supervisor independently re-verified).** User BYOK Provider a10c6189 / ofox.ai / openai/gpt-6-luna; opt-in enabled (generation 6→7); 1 personal EPUB uploaded (fixture, work 46028e71, 10 chapters, ready) and processed by the full worker; `user_personal_tag_run` reached `completed` at generation=7 with attempts=1 and no error. Two real AI calls succeeded: `personal-tagging.classify` (1,070 in / 200 out, 6,131 ms) and `personal-tagging.translation` (163 in / 60 out, 2,824 ms); the Provider returned no cost. The AI tag "Fables" (source_locale=en-US, localized name zh-CN 寓言, created_by=ai) was persisted through `user_work_tag` (source=ai) and visible via `GET /api/library/tags` (bookCount=1); the provider_id was the user's BYOK, not the instance. After acceptance, opt-in was restored to off (generation 8), the public-category due count stayed 0, the worker was stopped, and acceptance artifacts were kept.
- Still uncovered by real acceptance: **single-book re-run (deferred by design)**, real multi-user / multi-book batch semantics, and P2 historical backfill (by design there is none).
- Earlier P2 real-provider evidence (historical, retained): a provider run returned **8 valid structured outputs, 7/8 semantic passes, 1 miss** (knot-theory book judged adequately covered by an overly broad tag); at that time the **Worker end-to-end had not been run** — it has now been run once, with the bounded real sample above (1 book).
- Current code and automated tests are **not proof of real acceptance** by themselves; the bounded real-sample acceptance above does not extend to full-scale or multi-user behavior.
