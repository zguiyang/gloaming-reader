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
- **Separate acceptance tasks:** real AI translation, and automatic P2 behavior.
- Current code and automated tests are **not proof of real acceptance**.
- P2 real-provider evidence so far (partial): a later provider run returned **8 valid structured outputs, 7/8 semantic passes, 1 miss** (knot-theory book judged adequately covered by an overly broad tag); **Worker end-to-end was not run**. P2 semantic acceptance remains partial.
