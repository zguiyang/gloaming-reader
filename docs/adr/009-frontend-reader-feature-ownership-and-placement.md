# ADR-009: Frontend Reader Feature ownership, composition, and placement

**Status:** Accepted
**Date:** 2026-09-08
**Scope:** Internal ownership, composition/orchestration role, dependency
direction, and new-code placement for `apps/web/features/reader` and its App
Router composition under `apps/web/app/(reader)/**`. Records `reader-page` as
the Reader composition root. The **original decision work package** recorded
ownership and placement rules **without** migrating Reader files. **Later
authorized follow-ups** completed bounded **path-only** directoryization for
dictionary, assist, translate, and TTS / audio UI–sync; those moves did not
change ownership, dependency direction, public seams, or runtime behavior.
This record still does **not** extract TTS playback from `reader-page`, widen
`reader-parts-public`, relocate `reader-page` into `composition/`, introduce
`reader/index.ts` / `reader/shared` / `reader/common`, or require heartbeat /
chrome / core directoryization.

Related: [`.cursor/rules/frontend.mdc`](../../.cursor/rules/frontend.mdc) ·
[`.cursor/rules/repository-structure.mdc`](../../.cursor/rules/repository-structure.mdc) ·
[`docs/adr/004-frontend-reading-state-public-seams.md`](./004-frontend-reading-state-public-seams.md)
(reading-state seams; Reader may consume them; not superseded) ·
[`docs/adr/005-frontend-app-shell-site-chrome-ownership.md`](./005-frontend-app-shell-site-chrome-ownership.md)
(App Shell / Site Chrome; Reader group layout stays independent; not
superseded) ·
[`docs/adr/006-frontend-shelf-and-reader-parts-public-seams.md`](./006-frontend-shelf-and-reader-parts-public-seams.md)
(`reader-parts-public` seam; not superseded) ·
[`docs/adr/007-frontend-auth-feature-public-seam.md`](./007-frontend-auth-feature-public-seam.md)
(Auth public seam; `ReaderPage` may use `useAuthDialog`; not superseded) ·
[`docs/adr/008-frontend-admin-feature-ownership-and-placement.md`](./008-frontend-admin-feature-ownership-and-placement.md)
(Admin ownership; separate Feature; not superseded)

---

## Context

`features/reader` is a multi-cluster Feature root. Dictionary, assist,
translate, and TTS / audio UI–sync now live under capability directories
(`dictionary/`, `assist/`, `translate/`, `audio/`); other stable capabilities
remain expressed mainly by filename prefixes (`reader-heartbeat`,
`reader-api` / `reader-model` / `reader-part`, chrome / navigation files).
Path depth does not yet express every ownership cluster. Playback **control**
still lives in `reader-page`; `getReaderAudioTrack` remains Reader core in
`reader-api.ts`.

At record time:

- Dependency direction is overall healthy: App Router composes `ReaderPage`;
  `ReaderPage` assembles capabilities; capability private files do not import
  `reader-page`.
- The only intentional cross-Feature Reader data seam is `reader-parts-public`
  (`getWorkParts`), consumed by `book-detail` (ADR-006).
- There is no `features/reader/index.ts`, no `reader/shared`, and no
  `reader/common`.
- `reader-page.tsx` still owns concrete TTS playback control
  (`HTMLAudioElement`, play / pause / rate / accent role) in addition to
  orchestration. That is current reality; extraction is deferred.

Repeated prefixes, file count, and consumer count are investigation signals
only. They are **not** automatic criteria to split directories, invent a root
barrel, or create a generic shared layer in this decision.

---

## Decision

### Reader Feature is multi-cluster under a flat root

Treat `apps/web/features/reader` as a Feature root that hosts multiple stable
capability owners plus one composition/orchestration root. Do not place new
code as if the root were a single undifferentiated module. The original
decision did **not** itself migrate directories; subsequent bounded path-only
follow-ups may express owners in the path when separately authorized. Path
expression is not required for every remaining flat cluster (heartbeat,
chrome / navigation, core).

### `reader-page` (Reader composition / orchestration root)

| Field                           | Value                                                                                                                                                                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semantic role                   | Reader **composition / orchestration** root (not a capability cluster)                                                                                                                                                                                      |
| Current path                    | `apps/web/features/reader/reader-page.tsx` (`@/features/reader/reader-page`)                                                                                                                                                                                |
| Path disposition                | **Temporarily retained** at Feature root. Relocating into `composition/` (or similar) requires a separate decide gate.                                                                                                                                      |
| Owns                            | Assembling dictionary, assist / conversation, translate, TTS / audio, heartbeat, chrome / navigation, and Reader core into the reading experience; page-level selection / progress orchestration; current TTS playback control details still colocated here |
| Does not own                    | Capability-private API / UI / hook implementations as their semantic homes                                                                                                                                                                                  |
| Allowed consumer (verified)     | `apps/web/app/(reader)/read/[workId]/page.tsx` only                                                                                                                                                                                                         |
| Outward dependencies (verified) | Reader capability and core modules listed below; Auth public seam `useAuthDialog`; reading-state public seam helpers; `lib/auth`; generic UI                                                                                                                |

Rules:

- App Router `page` / route composition may deep-import `ReaderPage` under the
  framework composition exception in `frontend.mdc`. That is **not** a
  Feature-to-Feature public seam.
- Capability private implementation must **not** import `reader-page.tsx` or
  otherwise depend on composition private implementation.
- `ReaderPage` may assemble dictionary, assist, conversation, translate,
  TTS / audio, heartbeat, chrome, and core.
- This ADR does **not** extract TTS playback logic from `reader-page`.

Verified at record time: no file under `features/reader/**` other than
`reader-page.tsx` itself references `reader-page` / `ReaderPage`.

### Capability and core ownership (current paths)

Ownership follows semantic responsibility, not consumer count or filename
prefix alone. Paths below are verified current locations. Dictionary, assist,
translate, and TTS / audio UI–sync have completed **path-only**
directoryization under authorized follow-up work packages; those moves did
**not** change ownership, dependency direction, public seams, or runtime
behavior. They did **not** extract TTS playback control from `reader-page` or
relocate `getReaderAudioTrack`. Other clusters remain flat until a later
decide migrates directories.

| Owner                          | Current paths (verified)                                                                                                                                                                                      | Notes                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reader core                    | `reader-api.ts`, `reader-model.ts`, `reader-part.tsx`, plus unit tests (`reader-model.spec.ts`, `reader-state-command.spec.ts`)                                                                               | Bootstrap / parts / state query composition into view models; part rendering primitives                                                                                                                                                                                                                                                 |
| Reader chrome / navigation     | `reader-chrome.tsx`, `reader-chapter-nav.tsx`, `reader-toc-sidebar.tsx`, `reader-selection-toolbar.tsx`, `reader-unavailable.tsx`                                                                             | Reader-local chrome and chapter navigation; not App Shell / Site Chrome (ADR-005)                                                                                                                                                                                                                                                       |
| dictionary                     | `dictionary/reader-dictionary-api.ts`, `dictionary/reader-dictionary-view.tsx`, `dictionary/reader-dictionary-popover.tsx`, `dictionary/reader-dictionary-sheet.tsx`, `dictionary/reader-dictionary-card.tsx` | Dictionary API, view surfaces, and related UI. Path-only directoryization completed; ownership unchanged.                                                                                                                                                                                                                               |
| assist                         | `assist/reader-assist-api.ts`, `assist/use-reader-assist.ts`, `assist/use-reader-assist.spec.ts`, `assist/reader-ai-drawer.tsx`, `assist/reader-ai-inline.tsx`, `assist/reader-markdown.tsx`                  | Assist API, hooks, AI surfaces, markdown rendering. Path-only directoryization completed; ownership, dependency direction, public seams, and runtime behavior unchanged.                                                                                                                                                                |
| conversation (assist sub-face) | `assist/reader-conversations-api.ts` (consumed by `use-reader-assist`)                                                                                                                                        | Conversation transport under the assist ownership cluster; moved with assist path-only migration                                                                                                                                                                                                                                        |
| translate                      | `translate/reader-translate-api.ts`, `translate/use-reader-translate.ts`, `translate/use-reader-translate.spec.ts`                                                                                            | Translate API, hook, and tests. Path-only directoryization completed; ownership, dependency direction, public seams, and runtime behavior unchanged.                                                                                                                                                                                    |
| TTS / audio                    | `audio/reader-tts.tsx`, `audio/reader-audio-highlight.ts`, `audio/reader-audio-sync.ts`, `audio/reader-audio-sync.spec.ts`                                                                                    | Mini-player UI, listen highlight, timing / sync. Path-only directoryization completed; ownership, dependency direction, public seams, and runtime behavior unchanged. Playback **control** remains in `reader-page` (deferred extraction; not authorized by the path move). `getReaderAudioTrack` stays Reader core in `reader-api.ts`. |
| heartbeat                      | `reader-heartbeat.ts`                                                                                                                                                                                         | Reading heartbeat telemetry                                                                                                                                                                                                                                                                                                             |
| `reader-parts-public`          | `reader-parts-public.ts`                                                                                                                                                                                      | Approved cross-Feature data seam (ADR-006); not a capability UI cluster                                                                                                                                                                                                                                                                 |

Notes:

- Reading progress and reading-state transport stay on the Reader core /
  `features/reading-state` boundary (ADR-004). Do **not** place progress or
  state mutation logic into audio sync merely because playback and scroll can
  interact at composition time.
- `app/(reader)/layout.tsx` is a passthrough Reading Space group layout
  (independent of App Shell). It does not own Reader capability logic.

### Public boundary

| Field                                                  | Value                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Recorded cross-Feature data seam                       | `@/features/reader/reader-parts-public` — approved symbol `getWorkParts` (ADR-006)  |
| Cross-Feature consumer (verified)                      | `features/book-detail/book-detail-api.ts`                                           |
| Same-Feature consumer (not the cross-Feature contract) | `features/reader/reader-api.ts`                                                     |
| Feature root barrel                                    | **None.** Do not add `features/reader/index.ts` merely because a barrel is missing. |
| Route composition (not a Feature public seam)          | `app/(reader)/read/[workId]/page.tsx` → `ReaderPage`                                |

Rules:

- Keep `reader-parts-public` as the existing independent seam. This ADR does
  **not** modify, widen, or relocate it.
- Other Features must **not** deep-import Reader private implementation
  (`reader-page`, `reader-api`, capability files, chrome, etc.).
- New cross-Feature Reader data needs must pass an owner / symbol / consumer /
  lifecycle / dependency-direction review and update ADR-006 (or a successor)
  before any new public entry is treated as approved.
- Absence of `reader/index.ts` is intentional for this decide; it is not a
  defect to “fix” by inventing a barrel.

Verified at record time: the only non-route, non-owner import of
`@/features/reader/**` outside `features/reader/**` is
`book-detail` → `reader-parts-public`. No new unrecorded cross-Feature private
import was found.

### Dependency direction

Allowed:

```text
app/(reader)/** (route / page)
  → ReaderPage (framework composition)

ReaderPage (composition)
  → dictionary / assist / conversation / translate / TTS-audio / heartbeat
  → Reader core / chrome / navigation
  → recorded Feature public seams (Auth, reading-state) when needed
  → generic UI / lib / constants / Shared contracts

capability private implementation
  → own API / model / UI / hooks
  → Reader core types or helpers when ownership allows (e.g. reader-model)
  → recorded public seams / generic UI / lib / Shared contracts when needed
```

Forbidden:

```text
capability private implementation → reader-page (composition private)
capability private implementation → other composition-only private helpers
ordinary Feature → Reader private files
  (must use reader-parts-public or a newly recorded seam after decide)
Reader → invent unrecorded Feature public barrel / deep-export for cross-Feature use
```

### Placement test for new Reader code

Before adding a file under `features/reader`:

1. State the semantic owner and reason to change.
2. Prefer an existing owner:
   - dictionary → dictionary cluster (`dictionary/`, basename `reader-dictionary-*`)
   - assist / AI panel / markdown → assist cluster (`assist/`)
   - conversation message state / conversation API → assist or its conversation
     sub-face (`assist/reader-conversations-*` / assist hooks)
   - translate → translate cluster (`translate/`)
   - TTS playback UI, audio highlight, timing / sync → TTS / audio cluster (`audio/`)
   - heartbeat → `reader-heartbeat`
   - reading progress / reading-state → Reader core and/or
     `features/reading-state` (ADR-004); **not** audio sync by default
   - helpers that only serve `reader-page` orchestration → same layer as
     composition / chrome (Feature root beside `reader-page` / chrome today)
   - UI that only serves one capability → stay inside that capability
3. New Reader route / page composition entry → App Router under
   `app/(reader)/**` composing `ReaderPage` (or a future composition root after
   a separate decide). Do not invent a Feature public barrel for route wiring.
4. If two owners remain plausible after bounded research → **stop & ask**. Do
   not resolve ambiguity with `reader/shared`, `reader/common`, or by dumping
   into a semantically wrong file.
5. Do not split, promote, or create directories using LOC, file count, consumer
   count, or prefix count alone.

### Placement scenarios (normative guidance)

| #   | Scenario                                                  | Placement                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Dictionary result display block                           | dictionary cluster                                                                                                                                                                                                                                             |
| 2   | AI assist panel                                           | assist cluster                                                                                                                                                                                                                                                 |
| 3   | Conversation message state or UI                          | assist / conversation sub-face                                                                                                                                                                                                                                 |
| 4   | TTS playback control or audio status UI                   | TTS / audio cluster for UI / sync; **playback control remains in `reader-page` until a separate extract decide**                                                                                                                                               |
| 5   | Translate result display                                  | translate cluster                                                                                                                                                                                                                                              |
| 6   | Reading progress or sync-with-state logic                 | Reader core + reading-state public seams; not audio sync by default                                                                                                                                                                                            |
| 7   | Heartbeat state                                           | heartbeat (`reader-heartbeat`)                                                                                                                                                                                                                                 |
| 8   | Helper that only serves `reader-page`                     | composition / chrome layer beside `reader-page`                                                                                                                                                                                                                |
| 9   | Internal UI that only serves one capability               | that capability cluster                                                                                                                                                                                                                                        |
| 10  | `book-detail` needs Reader data                           | **Decision gate:** use recorded `reader-parts-public` only, or open a new public-seam decide (owner, symbol, consumer, lifecycle, dependency direction) and update ADR-006 / successor. **Forbidden:** private deep import of Reader internals                 |
| 11  | Cross-cutting UI across dictionary, assist, and translate | **Decision gate:** stop & ask for a named owner. **Forbidden:** creating `reader/shared` or `reader/common`, and forbidden private deep import from another Feature. Do not invent a catch-all helper directory because three capabilities need similar chrome |
| 12  | New Reader route / page composition entry                 | `app/(reader)/**` deep-imports the composition root (`ReaderPage` today); keep capability logic in Feature owners                                                                                                                                              |

### `reader/shared` / `reader/common` / root barrel constraint

Do **not** create `reader/shared`, `reader/common`, or `features/reader/index.ts`
because multiple Reader modules happen to need similar helpers, or because a
route wants a shorter import path.

A future Reader-level shared module or root barrel is allowed only after an
explicit decide that records:

- a named owner and stable responsibility;
- real consumers (or an explicit non-hypothetical stable contract / framework
  requirement for a public entry);
- inward / outward dependency direction;
- why existing capability, core, or composition owners are insufficient.

### Non-template clause

Concrete paths above document one Accepted layout. Future Reader surfaces must
re-read source and this ADR; they must not copy flat-root depth or prefix style
as a mandatory symmetric template. Do **not** treat still-deferred moves
(heartbeat directoryization, `reader-page` → `composition/`, TTS playback
extraction) as already completed. The four completed path-only clusters
(`dictionary/`, `assist/`, `translate/`, `audio/`) are current source reality
and must not be “undone” by reading older decision-time non-migration wording
in isolation.

### Explicit non-moves and later path-only follow-ups

**Original decision work package (no code migration):** That decide recorded
ownership, composition role, dependency direction, and placement rules. It
deliberately did **not**:

- migrate any Reader file or directory as part of the decide itself;
- create `reader/index.ts`, `reader/shared`, or `reader/common`;
- relocate `reader-page` into `composition/` or similar;
- extract TTS playback logic from `reader-page`;
- modify `reader-parts-public` or its approved symbols;
- change Reader runtime behavior, APIs, or product flows;
- modify ADR-004 / 005 / 006 / 007 / 008;
- reopen Auth, Shared, App Shell, Site Chrome, Navigation, content,
  work-cover, reading-state, or Admin ownership decisions;
- force any capability directoryization (including dictionary / assist /
  audio / translate / heartbeat) as a requirement of the decide.

**Later authorized follow-ups (completed, path-only):** Bounded directory
moves for dictionary, assist (including conversation sub-face), translate, and
TTS / audio UI–sync are **done**. Basenames, exports, ownership, dependency
direction, public seams, and runtime behavior were preserved. Those follow-ups
did **not** extract TTS playback control from `reader-page` or relocate
`getReaderAudioTrack` out of `reader-api.ts`.

**Still deferred (not authorized by path moves or this hygiene update):**

- `reader-page` → `composition/` (or similar);
- extracting TTS playback control from `reader-page`;
- heartbeat directoryization;
- chrome / navigation or Reader core directoryization;
- adding `reader/index.ts`, `reader/shared`, or `reader/common`;
- widening or relocating `reader-parts-public`.

---

## Consequences

- New Reader code is placed by **ownership** (composition, core, chrome,
  dictionary, assist / conversation, translate, TTS / audio, heartbeat, public
  seam), not only by copying filename prefixes.
- Directoryization of dictionary, assist, translate, and TTS / audio UI–sync
  has been completed as authorized path-only follow-ups; heartbeat
  directoryization is still **not** required by this ADR. Path moves do
  **not** authorize extracting playback control from `reader-page`.
- Moving `reader-page` into a `composition/` path requires an independent
  investigate → decide gate.
- Extracting TTS playback from `reader-page` requires a separate decide and is
  not implied by this record.
- Agents must not add a Reader Feature public barrel without satisfying the
  public-seam gate and updating the relevant ADR.
- Capability modules that import `reader-page.tsx` are a boundary violation
  under this record.
- Cross-Feature Reader data access remains ADR-006’s `reader-parts-public`
  unless a successor widens the contract.

### Lifecycle / future decision triggers

Re-open investigate → decide (update this ADR or a successor) when any of the
following becomes true:

- placement for a capability remains ambiguous across repeated changes;
- a still-flat stable capability (for example heartbeat) forms an independent
  lifecycle and multi-file change surface that needs path expression;
- composition vs capability dependency direction begins to blur;
- a real new cross-Feature consumer appears;
- TTS playback logic must be extracted from `reader-page`;
- `reader-page` should move into `composition/` (or similar);
- a Reader-level shared module or root barrel is proposed.

---

## Non-goals

Temporal note: “this work package” below means the **original ADR-009
decision** package (ownership / placement record). It is **not** a claim that
the four later path-only directory migrations never happened.

**Non-goals of the original decision work package:**

- Do not migrate Reader files or directories in that decide package.
- Do not add `reader/index.ts`, `reader/shared`, or `reader/common`.
- Do not modify `reader-page`, TTS / audio, dictionary, or other runtime as
  part of that decide.
- Do not modify `reader-parts-public`.
- Do not modify ADR-004 / 005 / 006 / 007 / 008.
- Do not reopen Auth, Shared, App Shell, Site Chrome, Navigation, content, or
  work-cover decisions.
- Do not treat Admin directoryization follow-ups as part of this Reader ADR.

**Completed after the decide (authorized follow-ups; not decision-time work):**
path-only directoryization of dictionary, assist, translate, and TTS / audio
UI–sync under the paths in the ownership table above.

**Still out of scope until a separate decide:**

- relocating `reader-page` into `composition/`;
- extracting TTS playback control from `reader-page`;
- heartbeat / chrome / core directoryization;
- inventing a Reader root barrel or `reader/shared` / `reader/common`;
- changing `reader-parts-public` or its approved symbols.
