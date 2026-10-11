# Tags and Taxonomy Domain Audit

**Status:** Read-only audit and proposal. No business code, schema, database rows, or running services were changed. No database connection, migration, Gutenberg sync, or AI provider was used.

**Repository baseline:** `dev-02` at `c1c153958a82a37767bb2b46c6f6b71f3861d7a3`. The available GitNexus index is 34 commits behind HEAD, so findings were traced manually against current source and migrations.

## 1. Executive Summary

There is one active classification-like user feature: private **User Tags**. A former public Catalog taxonomy existed in earlier migrations, but migration 0041 drops its `tag`, `category`, `source`, and work-association tables; none of those entities is present in the current Drizzle schema. There is no active System Taxonomy model or taxonomy Admin interface.

The visible Discover page currently lists published `ReadingWork` records through `GET /api/catalog/works`. A separate public SourceRecord API preserves Gutenberg Subjects and Bookshelves as raw source metadata, but the Web Discover feature does not call it. Neither path currently supplies normalized public categories to Discover.

AI metadata enrichment exists for descriptions only. AI genre/category classification, AI User Tag recommendations, and AI-to-taxonomy selection are **NOT IMPLEMENTED**.

**Recommendation:** keep User Tags private and freely named; retain source metadata as source-owned raw facts; if public categories are approved, introduce a small controlled vocabulary with stable IDs and explicit source-to-term mapping. Treat AI output as suggestions that reference those stable IDs, never as taxonomy writes or implicit User Tag assignments. Do not add schema before the product taxonomy and its first Discover use are approved.

## 2. Current Domain Inventory

| Concept                                | Current status                | Evidence and boundary                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Personal User Tags                     | **IMPLEMENTED**               | `user_tag` is owned by `user_id`; `user_work_tag` links a user's tag to a ReadingWork. Routes require authentication and service queries scope by the authenticated user. [Schema](../../../packages/db/src/schema.ts#L199-L240), [routes](../../../apps/backend/src/domains/library/tags/routes.ts#L23-L55).                                                                                                   |
| System Taxonomy                        | **NOT IMPLEMENTED (current)** | Historical Catalog taxonomy tables were removed in migration 0041. The current schema has no `category`, global `tag`, or `reading_work_category`; tests assert no Admin taxonomy or Catalog taxonomy routes. [Migration](../../../packages/db/migrations/0041_remove_catalog_taxonomy.sql#L1-L6), [absence test](../../../apps/backend/tests/unit/routes/catalog-management-route-absence.spec.ts#L13-L24).    |
| Source Metadata                        | **PARTIAL**                   | Gutenberg RDF parsing stores raw Subjects and Bookshelves in `SourceRecord.sourceMeta`; this is source metadata, not Gloaming taxonomy. [Parser](../../../apps/backend/src/domains/discovery/gutenberg/rdf-parser.ts#L61-L91), [schema](../../../packages/db/src/schema.ts#L961-L1028).                                                                                                                         |
| Discover classification                | **NOT IMPLEMENTED**           | Web Discover lists published Catalog Works without category fields or filters. A separate SourceRecord API exists but Web Discover does not call it. [Discover client](../../../apps/web/features/discover/discover-api.ts#L38-L59), [page](../../../apps/web/features/discover/discover-page.tsx#L43-L67), [SourceRecord routes](../../../apps/backend/src/domains/discovery/routes/index.ts#L11-L21).         |
| AI classification / AI tag suggestions | **NOT IMPLEMENTED**           | Metadata enrichment's only field is `description`; its prompt returns a description, and a test asserts it contains no tag/category instruction. [Fields](../../../apps/backend/src/domains/metadata/enrich/fields.ts#L1-L6), [AI call](../../../apps/backend/src/domains/metadata/enrich/ai-enrichment.ts#L22-L43), [test](../../../apps/backend/tests/unit/domains/metadata/metadata-enrich.spec.ts#L45-L57). |

“NOT IMPLEMENTED” means absent from the current source paths/schema inspected, not that no future document proposes it.

## 3. Actual Data Flow

### 3.1 Personal Library tags

```text
Authenticated user
  → /api/library/tags CRUD
  → user_tag(user_id, id, name, normalized_name)
  → user_work_tag(user_id, work_id, tag_id)
  → Library projection for that same user
```

The database enforces per-user `(user_id, normalized_name)` uniqueness and a composite ownership foreign key from the association to the same user's tag. The tag service allows tagging one's own Personal Work or a published Catalog Work explicitly saved to the Library, and rejects another user's private Work or an unsaved Catalog Work. Deleting a User Tag removes its associations, not the Work. This is a coherent private organization feature, not public content classification. [Schema](../../../packages/db/src/schema.ts#L199-L240), [service](../../../apps/backend/src/domains/library/tags/service.ts#L118-L198).

### 3.2 Discover and source metadata

```text
Gutenberg RDF snapshot
  → parse dcterms:subject + pgterms:bookshelf
  → source_record.source_meta JSON (raw upstream strings)
  → GET /api/discover/records (list omits sourceMeta)
  → GET /api/discover/records/:sourceRecordId (detail returns sourceMeta)
```

SourceRecord identity is explicitly `sourceRecordId`; its optional `workId` points to a separately identified materialized ReadingWork. The SourceRecord list query joins the source, not ReadingWork, so a record can be listed before materialization. It filters enabled sources and `available` records, defaults language to English, and supports search and pagination; it has no taxonomy/category filter. Raw Subjects and Bookshelves are not converted into Gloaming terms in the parser. [DTO](../../../packages/shared/src/discovery/discovery.ts#L44-L97), [query](../../../apps/backend/src/domains/discovery/read-model/source-records.ts#L23-L57), [mapping](../../../apps/backend/src/domains/discovery/read-model/source-records.ts#L70-L142).

### 3.3 Two distinct Discover paths

The current Web Discover client calls `/api/catalog/works`; its backend reads published public Catalog ReadingWorks and counts their ReadingParts. It searches title and supports pagination/sort, but joins no category table and returns no taxonomy projection. Separately, `/api/discover/records` and its detail endpoint provide a SourceRecord read model, but `apps/web/features/discover/discover-api.ts` does not call those endpoints.

Therefore, “Discover categories come from Gutenberg” would be inaccurate today. Gutenberg raw classification-like values are preserved for SourceRecord detail; current visible Discover is based on published ReadingWork and has no category source. This is an integration boundary, not evidence that SourceRecord storage is absent. [Catalog routes](../../../apps/backend/src/domains/works/routes/catalog.ts#L8-L18), [Catalog query](../../../apps/backend/src/domains/works/catalog/catalog.ts#L20-L70).

### 3.4 Admin and materialization

Current Discovery Admin routes expose Project Gutenberg status, enable/disable and manual sync only; they do not edit categories or mapping. SourceRecord materialization creates a ReadingWork but deliberately creates no Library item, ReadingState, or User Tag. There is no inspected route or service mapping SourceRecord metadata into public taxonomy terms. [Admin routes](../../../apps/backend/src/domains/discovery/routes/admin.ts#L12-L32), [materialization contract](../../../apps/backend/src/domains/discovery/materialization/service.ts#L14-L27).

## 4. User Tag Naming Rules and Compatibility

### Current behavior

The shared write schema trims the name and allows 1–80 JavaScript string code units. No allowed-character policy is defined there. The backend trims again and persists this uniqueness key:

```ts
value.toLowerCase().replace(/[^a-z0-9]+/g, '') || value.toLowerCase().trim();
```

| Input       | Current key | Consequence                                                         |
| ----------- | ----------- | ------------------------------------------------------------------- |
| `英语学习2` | `2`         | Chinese letters disappear because the string has an ASCII digit.    |
| `儿童文学2` | `2`         | Collides with `英语学习2` for the same user.                        |
| `C++`       | `c`         | Punctuation distinction disappears.                                 |
| `.NET`      | `net`       | Leading punctuation is discarded.                                   |
| `AI/ML`     | `aiml`      | Slash distinction is discarded.                                     |
| `中文 标签` | `中文 标签` | Without ASCII alphanumerics, fallback preserves the internal space. |

This function does not reject Chinese, but erases CJK portions from mixed ASCII/CJK names. It also removes punctuation and spaces when any ASCII alphanumeric remains. `toLowerCase()` is not full Unicode case folding. There is no NFC/NFKC step, grapheme-count policy, explicit control/invisible/bidi policy, or separate frontend uniqueness implementation. The unit test covers plain English and CJK-only names, not mixed names or punctuation. [Normalizer](../../../apps/backend/src/domains/library/tags/normalization.ts#L1-L5), [write schema](../../../packages/shared/src/library/library.ts#L17-L25), [tests](../../../apps/backend/tests/unit/domains/library/user-tag-normalization.spec.ts#L5-L10).

The database uniqueness is per-user. Two users may both create `React学习`; their tag IDs and associations remain distinct. Same display names in a User Tag and any future taxonomy would not imply shared identity.

### Recommended name contract (proposal only)

1. Trim Unicode whitespace and collapse internal whitespace runs to one ordinary space.
2. Normalize the comparison key to NFC and use a defined, locale-independent Unicode case-fold policy; document/pin its behavior so a runtime upgrade does not silently redefine identity.
3. Preserve meaningful punctuation and letters. `C++`, `C#`, `.NET`, `AI/ML`, hyphens and mixed scripts should remain distinct where their normalized forms differ.
4. Permit emoji and combining marks. If the limit describes visible characters, enforce it in grapheme clusters rather than UTF-16 code units.
5. Reject C0/C1 controls and dangerous bidi override controls with a clear message. Do not strip all format characters indiscriminately: joiners and variation selectors are used by scripts and emoji. Render names as text, never HTML, and use bidi-safe display for mixed-direction strings.
6. Treat canonically equivalent spellings as the same identity. Do not silently merge visually similar but semantically distinct scripts or punctuation variants.

A personal label should not be restricted to a category vocabulary.

### `normalized_name` history and safe repair

Migration 0040 created User Tag tables and the uniqueness constraint; it did not seed a standard vocabulary. Current tag-row count and collision count are **UNKNOWN** because no database was queried.

Changing only the application normalizer would leave historic keys under the old rule. A safe repair must preserve tag IDs and associations:

1. Run a read-only per-user preflight that computes candidate new keys and lists collision groups; avoid exposing private names in shared logs.
2. Resolve collisions explicitly (user rename or reviewed exception). Never merge IDs/associations silently.
3. In a coordinated migration/deployment, update keys and the unique constraint atomically; verify one key per user and every association still references the same tag ID.
4. Keep a reversible backup of `(user_id, tag_id, prior_normalized_name)` for a rollback window, or use an expand-contract transition if deployment cannot be atomic.
5. Test against `gloaming_test`: collision fixtures, ID/association preservation, ownership, create/rename/delete, and concurrent uniqueness.

Whether a data migration is required depends on whether persisted tags exist and whether preflight finds incompatible keys. A production-quality switch to persisted uniqueness semantics should be treated as a migration until evidence proves the database is empty. No migration or database read was performed.

## 5. Discover Classification Sources

| Question                                            | Current fact                                                                                                                                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What categories appear in current Discover?         | None are sourced or displayed by the current Discover list model. It renders Catalog Works and Library membership/progress.                                                                    |
| Current API/tables?                                 | `/api/catalog/works` reads `reading_work` and counts ReadingParts; no category join. The list route has no auth middleware.                                                                    |
| Is there a global Genre/Category/Taxonomy?          | No active table/model in current schema. Earlier tables were removed in 0041.                                                                                                                  |
| Does Discover read ReadingWork tags?                | No. Catalog DTO/projection does not expose them; Catalog tests assert there is no `tags` property.                                                                                             |
| Does it read SourceRecord metadata?                 | Not in the Web Discover client. The separate detail DTO returns raw `sourceMeta.subjects` and `bookshelves`; the list DTO omits `sourceMeta`.                                                  |
| Are Gutenberg Subjects/Bookshelves captured?        | Yes, as raw SourceRecord metadata; no normalization or mapping to Gloaming categories is present.                                                                                              |
| Is a mapping layer implemented?                     | **NOT IMPLEMENTED** in current schema/routes/code paths inspected.                                                                                                                             |
| Is a hardcoded Discover category list present?      | None found in the current Discover feature/API.                                                                                                                                                |
| Do private User Tags affect Discover?               | No. They belong to per-user Library data and are absent from the public Catalog query.                                                                                                         |
| Can source metadata be read before materialization? | Yes. SourceRecord list/detail do not require `workId`; no normalized classification is computed.                                                                                               |
| Can later sources reuse the current mapping?        | Not yet. SourceRecord has generic source identity fields, but Admin V1 and the parser are Gutenberg-specific.                                                                                  |
| Does old Catalog taxonomy coexist?                  | Historical migration files document it, but 0041 drops the tables. Current Catalog ReadingWork and SourceRecord APIs coexist as different read paths; current Web Discover uses Catalog Works. |

SourceRecord and ReadingWork IDs are not interchangeable. `sourceRecordId` is Discover-record identity; nullable `workId` links to a materialized Work. A future UI must preserve that distinction.

## 6. AI Classification Contract (Recommended Future Behavior)

**Current capability:** no AI taxonomy or User Tag classifier exists. Metadata AI creates descriptions; that does not imply a classification capability.

### How AI should cooperate with personal tags

| Candidate                                                            | Benefit                                                                                                         | Cost/risk                                                                                                                                                                                                           | Verdict                                                                                     |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| A. AI selects only from the current user's tags                      | The result uses familiar labels.                                                                                | New users have no candidate set; personal tags may be arbitrary collections, languages, years, or reading intentions rather than content types. Results vary by user and do not support consistent public Discover. | Do not use as the classifier's only vocabulary.                                             |
| B. AI selects only from System Taxonomy                              | Stable IDs, multilingual labels and consistent public classification.                                           | If presented as a second personal filing system with no adoption path, users have to manage two parallel ways to organize a book.                                                                                   | Use as the classifier's semantic source, but not as an automatic personal tag write.        |
| C. AI selects a system term, then offers an explicit personal action | Combines stable classification with user choice. Can offer an existing tag or create/apply one on confirmation. | Requires a small suggestion/adoption interaction and must not equate equal names as equal identities.                                                                                                               | **Recommend.** Keeps the user in control and avoids creating a tag for every AI suggestion. |

If classification is approved:

- AI receives a bounded approved set of stable term IDs and facet context; it returns candidate IDs, confidence/evidence and may return `unmatched` or `uncertain`.
- AI cannot create/rename terms, persist arbitrary generated text as a public category, or publish a public classification by itself.
- Keep candidate quantity small (for example, one primary genre/form and a few distinct subjects); do not fill a quota.
- Public Discover assignments come from curated source mapping or explicit maintainer review. Low confidence/unmatched means no public assignment.
- For a personal work, suggestions are opt-in. User confirmation is required before reusing/creating a User Tag. Never auto-create tags.
- Equal display names do not imply shared IDs. A UI can offer “use my existing tag” after a match, but only explicit confirmation binds to that user's tag ID.
- Chinese and English labels should localize the same stable term ID when they are translations.

Genre and literary form are not identical to subject or audience. Science fiction and romance are genres; prose, fairy tale and fable are forms that may overlap with genre; computer science/database/history are subjects; children's literature may imply audience plus domain. MVP recommendation: a small flat `genre/form` facet and a `subject` facet, without nested hierarchy; defer audience unless a concrete browse use case requires it.

## 7. Domain Boundaries and Lifecycle

| Domain                             | Owner and lifecycle                                                                                                         | Must not affect                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| User Tags                          | One user's freely named, private Library labels and associations. Current `user_tag` / `user_work_tag`.                     | Other users, public Discover taxonomy, raw source metadata.    |
| Source Metadata                    | Source-owned raw facts keyed to a source record; preserve source strings and provenance.                                    | User Tag identity or public taxonomy without explicit mapping. |
| System Taxonomy (future)           | Gloaming-owned stable IDs, localized display names, aliases, facet and active/deprecated lifecycle. Maintainer-owned.       | Private tag IDs/names and raw source data.                     |
| Mapping/public assignment (future) | Curated mapping from source-specific terms or records to stable system term IDs; retains source key and mapping provenance. | Original raw metadata and User Tags.                           |
| AI Suggestions (future)            | Candidates referencing approved IDs; explicit user/maintainer accept or reject. Persist provenance if stored.               | Formal terms or User Tags until confirmed.                     |

The proposed “raw source metadata → curated mapping → controlled Discover terms” direction is sound if mapping is an explicit boundary and never overwrites upstream Subjects/Bookshelves. Personal organization remains “User Tag → user/work association.”

Use separate identities and association semantics. User rename/delete must not alter public classification; taxonomy localization/rename must not rename a User Tag. Term rename keeps stable ID; merge/deprecation uses an auditable successor/alias and preserves historical links. Re-import keys mappings by source identity and source term/identifier while retaining original text. Taxonomy maintenance belongs to a maintainer/Admin only if that capability is separately approved; User Tag management remains a user capability.

## 8. Architecture Alternatives

| Option                                                                  | Clarity                                                                                  | AI/data quality                                                    | Discover/privacy                                               | Complexity and maintenance                                                      | Assessment                                                             |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1. One global Tag system for users, AI and Discover                     | Initially appears simple, but ownership is confusing.                                    | User edits and free-form AI cause vocabulary drift.                | Private/public collision and leakage risk.                     | Fewer initial tables, high coupling and migration cost.                         | **Reject.** Breaks the private User Tag contract.                      |
| 2. Fully independent User Tags and System Taxonomy, no coordination     | Clear ownership, but users can experience two unrelated organization systems.            | Public IDs remain stable.                                          | Strong isolation, no path to personal organization assistance. | Moderate duplicate lookup/presentation work.                                    | Safer than 1, but disconnected.                                        |
| 3. Independent domains with controlled mapping and explicit suggestions | Users see “My tags” and stable Discover categories; suggestions appear only when useful. | AI selects IDs, can abstain; human review protects public quality. | Source mappings reusable; personal tags isolated.              | Moderate, staged complexity; schema only when persisted/admin needs justify it. | **RECOMMEND.** Preserves boundaries and supports explicit cooperation. |

A name match may help the UI offer reuse, but it never proves identity. Any reuse is an explicit action resolved to the user's existing tag ID.

## 9. Scenario Walkthroughs

| Scenario                                                                | Recommended behavior                                                                                                                            |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| A. New user uploads an English fairy tale; AI suggests Fairy tale       | Suggest an approved term ID. Do not create a User Tag. Offer “Add as a Library tag”; explicit confirmation creates/applies one or dismisses it. |
| B. User has Children’s literature; AI suggests Fairy tale               | Keep concepts distinct. Do not auto-create. Let the user reuse the broad existing tag, create a new one, or dismiss.                            |
| C. DDIA; terms include computer science, database, software engineering | Suggest a small number of evidence-backed subject IDs. Never generate labels such as “DDIA study 2026”. User-authored tags stay explicit.       |
| D. Gutenberg has multiple Subjects                                      | Preserve raw strings in `sourceMeta.subjects`; map only known terms through reviewed mappings. Leave unknown values unmapped.                   |
| E. Second source has different vocabulary                               | Map its source-specific terms to the same stable IDs where semantics match; preserve original metadata and provenance.                          |
| F. Two users create React学习                                           | Separate private tag IDs/associations, even with equal names.                                                                                   |
| G. Same user creates 英语学习2 and 儿童文学2                            | Preserve both distinct names; new key semantics must retain CJK/punctuation; preflight detects historic collisions.                             |
| H. No approved term fits                                                | Return unmatched/uncertain; do not force a wrong class or auto-add a formal term. Maintainer may propose one later.                             |
| I. User deletes their 科幻小说 tag; public term has same label          | Delete only that private tag and associations. Public taxonomy and Discover remain unchanged.                                                   |
| J. Public Sci-Fi label changes to Science Fiction                       | Keep stable term ID; update display localization and retain Sci-Fi as an alias if useful. Personal tags are untouched.                          |

## 10. Data Compatibility

`normalized_name` is a uniqueness key, not identity. `user_tag.id` and association keys carry identity. Current database uniqueness is per user and per user/work/tag association; it does not prove historical display names are collision-free under a future Unicode rule.

No live database was queried. Existing User Tag count and actual collision count are **UNKNOWN**. Source proves a collision class exists under the current function, not that such duplicate rows already exist.

Before changing behavior, define equality and run a read-only collision report. Resolve incompatible existing forms without dropping either tag; preserve IDs/associations. Back up old keys and use a transactionally verified migration with rollback window. Tests must cover stable IDs, association preservation, ownership, uniqueness races, rename/delete and Unicode fixtures. Do not silently merge tags.

## 11. Minimal Implementation Proposal (Not Authorized)

### Reuse

- Keep current User Tag tables, CRUD, ownership rules, associations, Library filters and management UI.
- Keep SourceRecord raw metadata and separate `sourceRecordId` / `workId` identities.
- Reuse SourceRecord list/detail for a future SourceRecord Discover surface only after resolving its boundary with the currently shipped Catalog Work page.

### Fill only after approval

- **Phase A:** define safe Unicode identity and preflight collisions; separately authorize any migration.
- **Phase B:** clarify current Discover contract and choose whether Web Discover moves from published ReadingWorks to SourceRecords. Never expose private tags.
- **Phase C:** approve facets and a small vocabulary. Start with version-controlled stable IDs, localization and reviewed source mappings if one maintainer/low volume is sufficient. Add persistent taxonomy/mapping/assignment tables and Admin editing only when live editing, provenance, query scale or source count requires them.
- **Phase D:** AI candidates over approved IDs with explicit accept/dismiss; no automatic writes.

### Not needed now

A generic hierarchy engine, user-editable global categories, AI taxonomy authoring, a second tag center, automatic User Tag creation, or a schema migration before the vocabulary and Discover use are approved.

## 12. Phased Plan

| Phase                            | Scope                                                                                                                                                    | Acceptance gate                                                                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — User Tag name safety         | Approve Unicode equality/display policy; read-only collision preflight; separately authorize code/data migration.                                        | Mixed CJK/ASCII and punctuation stay distinct; canonical equivalents are predictable; tag IDs/associations unchanged; no silent merge; rollback/test evidence reviewed. |
| B — Public/private boundary      | Record the actual Discover contract and decide whether/when Web Discover moves to SourceRecords. Preserve raw source facts.                              | Public Discover never depends on personal tags; unmaterialized SourceRecord keeps its identity; current and intended DTOs are distinct.                                 |
| C — Controlled public categories | Approve facets and a small initial vocabulary; stable IDs/locales and curated source mapping. Add Admin/schema only if operational need is demonstrated. | Different source vocabularies map to one term where appropriate; unknown terms remain available; rename/deprecate preserves links.                                      |
| D — AI suggestions               | Select only approved IDs, allow abstention and include evidence/confidence; explicit user/maintainer decision.                                           | Unmatched stays unclassified; no AI writes; suggestions remain distinct from source facts, public assignment and private tags.                                          |

These are proposals, not active implementation instructions. No phase was started.

## 13. Open Product Decisions

| Decision                       | Recommendation                                                                                                                  | Alternative                                                        | Approval impact                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| First public dimensions        | Flat `genre/form` and `subject`; defer audience.                                                                                | One mixed list or separate genre/form/subject/audience facets.     | Defines Discover navigation, AI candidate contract and mapping scope.                 |
| Discover's next canonical list | Treat SourceRecord as source-catalog identity before materialization, with explicit Work links; migrate UI in a separate phase. | Retain current published-Work catalog until source policy changes. | Affects routes, DTOs, card actions, and whether categories exist pre-materialization. |
| Vocabulary ownership           | Version-controlled curated vocabulary/mappings first; add Admin editing when needed.                                            | Build taxonomy Admin now.                                          | Determines whether database persistence/Admin are necessary.                          |
| Personal AI suggestion         | Opt-in suggestion; apply/reuse User Tag only after confirmation.                                                                | Automatically create/apply tags.                                   | Auto-write risks tag proliferation and changes user data.                             |
| Unicode equivalence            | NFC + defined Unicode case-fold + collapsed whitespace; preserve punctuation; reject selected controls.                         | Exact spelling or NFKC compatibility folding.                      | Changes duplicate semantics and historical migration requirements.                    |

Code-resolvable facts are settled above; only product policy remains open.

## Evidence Index

- User Tag schema and ownership: [schema.ts](../../../packages/db/src/schema.ts#L199-L240)
- User Tag validation/normalization/unique checks: [shared schema](../../../packages/shared/src/library/library.ts#L17-L25), [normalizer](../../../apps/backend/src/domains/library/tags/normalization.ts#L1-L5), [service](../../../apps/backend/src/domains/library/tags/service.ts#L57-L105)
- Access policy and routes: [routes.ts](../../../apps/backend/src/domains/library/tags/routes.ts#L23-L55), [service.ts](../../../apps/backend/src/domains/library/tags/service.ts#L118-L198)
- SourceRecord metadata and optional Work link: [schema.ts](../../../packages/db/src/schema.ts#L961-L1028)
- Gutenberg source metadata: [rdf-parser.ts](../../../apps/backend/src/domains/discovery/gutenberg/rdf-parser.ts#L61-L91)
- SourceRecord DTO/query: [discovery.ts](../../../packages/shared/src/discovery/discovery.ts#L44-L97)
- SourceRecord API/read model: [routes](../../../apps/backend/src/domains/discovery/routes/index.ts#L11-L21), [source-records.ts](../../../apps/backend/src/domains/discovery/read-model/source-records.ts#L23-L57), [source-records.ts](../../../apps/backend/src/domains/discovery/read-model/source-records.ts#L70-L142)
- Current Web Discover and Catalog API: [discover-api.ts](../../../apps/web/features/discover/discover-api.ts#L38-L59), [discover-page.tsx](../../../apps/web/features/discover/discover-page.tsx#L43-L67), [catalog routes](../../../apps/backend/src/domains/works/routes/catalog.ts#L8-L18), [catalog read model](../../../apps/backend/src/domains/works/catalog/catalog.ts#L20-L70)
- Taxonomy retirement and route absence: [0041 migration](../../../packages/db/migrations/0041_remove_catalog_taxonomy.sql#L1-L6), [absence test](../../../apps/backend/tests/unit/routes/catalog-management-route-absence.spec.ts#L13-L24)
- AI scope: [fields.ts](../../../apps/backend/src/domains/metadata/enrich/fields.ts#L1-L6), [ai-enrichment.ts](../../../apps/backend/src/domains/metadata/enrich/ai-enrichment.ts#L22-L43), [test](../../../apps/backend/tests/unit/domains/metadata/metadata-enrich.spec.ts#L45-L57)

## Audit Completion

This is a source/schema/migration audit, not live-data or runtime verification. No database contents, account tag names, current source sync state, or live API response were inspected. Three pre-existing `pi-delegate` deletions and the `skills-lock.json` modification were left untouched. No business code or data was modified; nothing was staged, committed, pushed, reset, cleaned, or stashed.
