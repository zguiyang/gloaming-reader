# Library Management Capability

**Investigation baseline:** branch `dev-02`, HEAD `42653eb4a767df4a5031b7ebaa8536daace535a3` (2026-09-29). This is a source investigation only; no runtime/API/schema/test changes are included.

## 1. Domain Classification

The current backend builds Library membership from two separate domain facts:

- **Personal Work** — `reading_work.owner_user_id` equals the authenticated user's ID. Personal upload sets `origin_kind = user_epub`, `visibility = private`, `published_at = NULL`, and derives ownership from the session.
- **Saved Catalog Work** — a row exists in `user_library_item` for the authenticated user and the Work passes the public Catalog predicate. This is an explicit save, independent of reading progress.

`Continue Reading` is a projection of the latest `reading_state.status = in_progress`; it is not a source category or Library membership record. A Work can have reading state without an explicit Catalog save.

These facts follow the Work/Library separation in `docs/adr/001-reading-content-domain-model.md` and `docs/product/engineering-vocabulary.md`. `visibility`, `published_at`, title, cover presence, and other presentation fields do not define the two Library source categories.

## 2. Current Library Contract

`GET /api/library` returns `LibraryData { current, items }`.

Each item contains:

- `work`: `id`, `title`, `description`, `tags`, `coverAssetId`, and `publishedAt`;
- nullable reading `state`;
- `availability` (`processing | ready | failed`);
- `canRemoveFromLibrary`.

It does **not** return `owner_user_id`, `origin_kind`, `visibility`, or an explicit `source`/ownership discriminator. The backend knows the source while querying: owned rows use `reading_work.owner_user_id = authenticated user`; saved rows use `user_library_item` joined to public Catalog Works.

Today the DTO sets `canRemoveFromLibrary = false` for the owned query and `true` for the saved Catalog query. Therefore the current web client can distinguish the two sets by this field for the current implementation. This is an operation capability being used as an implicit type tag; it is not an explicit or durable source contract. The frontend has no independent ownership/source field. `publishedAt` and other Work summary fields are not a safe substitute.

The merged `items` list is sorted and then capped at `LIBRARY_ITEMS_LIMIT = 48`. Client filtering can classify the returned rows, but a category may be incomplete when the global 48-row cap has already excluded rows from that category.

## 3. Personal Work Edit

**Personal metadata edit: Not implemented.** There is no authenticated Personal Work update route, Personal update service/command, or Personal repository operation.

There is an Admin-only Catalog endpoint, `PATCH /api/admin/catalog/works/:id`, backed by `updateWork`. Its catalog-only policy means it is not a Personal Work edit capability. It accepts title, author, description, tags, sources, category, suggested vocabulary size, and difficulty score. It does not accept a cover field; cover replacement is not part of this update body. Admin UI availability does not grant this capability to a Library user.

The existing personal upload route only creates a Work and queues ingest; it is not an edit endpoint.

## 4. Personal Work Delete

**Personal user delete: Not implemented.** There is no authenticated Personal delete endpoint or Personal delete service/command.

The only Work delete route found is Admin-only `DELETE /api/admin/catalog/works/:id`. It calls `deleteWork`, which accepts only Catalog Works and rejects published Works until they are unpublished. It is not authorized for or designed as a Personal Work delete operation.

The existing Admin Catalog delete lifecycle is broader than deleting one row:

1. In a database transaction, it locks and validates the Work; collects its part IDs and persisted `content_asset` rows; handles origin-upload reference counts; deletes conversations whose subject is this `reading_work`; and deletes the Work.
2. Database foreign keys cascade from `reading_work` to `reading_part`, `content_asset`, `user_library_item`, and `reading_state`. Deleting parts cascades their part-owned assets; `reading_state.current_part_id` is set null if a part alone is deleted.
3. After commit, it best-effort deletes known object-storage keys (including legacy audio keys), while checking whether a key remains referenced; it decrements/deletes the shared uploaded-object registry as appropriate. It also attempts to delete per-part bilingual translation caches. Failed external cleanup is logged and left for the existing asset orphan-scan/retry workflow.
4. Deleting a conversation cascades its `conversation_message` rows. Although the conversation schema describes its subject ID as polymorphic with no Work FK, this command explicitly deletes matching `reading_work` conversations.

The command does not directly delete a table named `reading_history`; current reading history is projected from `reading_state` plus per-user `reading_day` aggregates. Work deletion cascades the per-Work reading state, so the Work-specific history derived from that state disappears. `reading_day` and heartbeat dedupe rows are user/date aggregates without a Work FK and remain.

Persisted content assets and their known external objects receive cleanup handling, but a Work delete is not a blanket proof that every transient or future derived object is covered. In particular, parse-attempt object keys can temporarily live in `reading_work.origin_meta.workflowParseArtifacts` before asset rows commit; the delete command's cleanup inventory is based on persisted assets. Active ingest therefore needs separate coordination and orphan handling.

## 5. Processing / Failed Delete Safety

The Personal upload path creates an `uploaded` Work, prepares a database workflow enqueue lease, and submits a BullMQ parse job. The parser claims and renews a database lease, can upload temporary image/cover objects, writes parts and asset rows, then advances state. The queue job itself is not represented as a foreign-key child of the Work.

| Personal Work state   | Current safe user delete?                         | Evidence and limitation                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uploaded`            | **No supported safe delete**                      | A parse job may already be queued or claimable. There is no Personal delete endpoint and no delete path that removes/cancels the BullMQ job or fences a pending claim.                                                                        |
| `processing`          | **Unsafe with current lifecycle**                 | A worker may hold a renewable lease and write staged objects while deletion runs. `deleteWork` does not cancel/wait for the job or coordinate with that lease. A later worker write can fail after Work removal and leave an external orphan. |
| `parsed` / `metadata` | **Not established as safe for Personal deletion** | The current Personal EPUB path normally advances from parsing to `ready`; these are shared workflow states, not a Personal delete guarantee. There is no Personal delete path to check for outstanding queue records or cleanup.              |
| `failed`              | **Not established as safe**                       | Failure state alone does not prove the queue has no retry/delayed/active record or that all lease/artifact state is settled. No user delete path checks these conditions or coordinates external cleanup.                                     |

No Personal state is currently exposed as safely deletable. A future operation would need a defined job/lease fencing and cleanup lifecycle, not just a Work-row delete. The existing Admin Catalog deletion command also does not remove a BullMQ job or inspect/serialize against all worker activity, so it is not evidence of safe Personal deletion during processing.

## 6. Saved Catalog Management

- **View detail:** Available for published Catalog Works through `GET /api/catalog/works/:id` and the existing `/discover/:workId` detail page. The Library card does not currently expose a detail-menu action, but the existing detail surface is available by navigation.
- **Read / continue:** Available for `ready` Library items through the existing Reader route. Reading state is loaded independently; opening a Work is not what creates Catalog Library membership.
- **Remove from Library:** Available through `DELETE /api/library/:workId`. The service deletes only the matching user's `user_library_item` row and returns success if no row existed. It does not delete the Work, `reading_state`, or reading activity/history. The existing schema explicitly separates Library membership from progress.

## 7. Filter Feasibility

**Option A — client-side filter using the existing response:** possible only for the rows returned in the current response. `canRemoveFromLibrary` presently separates saved Catalog rows from owned Personal rows, but its name and purpose are removal permission, not source identity. The global 48-item cap can also omit rows before a client-side category filter runs.

**Option B — backend query/filter:** needed if category results must be filtered before the 48-item limit. A small optional source filter on `GET /api/library` can apply the existing owner/membership predicates before ordering and limiting.

**Option C — explicit DTO source field:** needed for a stable frontend contract. Return an explicit discriminator such as `source: 'personal' | 'catalog'`, derived from the same owner and explicit membership predicates. Do not infer it from title, publication timestamp, cover, or visibility.

**Minimum reasonable choice: B + C.** Add the explicit source discriminator and an optional source filter to the existing Library endpoint; apply that filter before the current limit. Keep `current` separate as the reading-state projection. This avoids coupling category semantics to `canRemoveFromLibrary`. The existing all-items response remains capped at 48; if product acceptance requires showing more than 48 total items in “全部,” pagination or a different limit is a separate API decision.

## 8. Proposed UI Capability Matrix

“Available” describes current backend/domain capability; a route is not considered a supported Personal action merely because an Admin Catalog equivalent exists.

| Work Type          | View                                                                                     | Edit                                                               | Remove                                                                                    | Delete                                                                                                                | Current Support                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Personal Work      | **Available** — open Reader when `ready`; a separate Personal detail page is **Missing** | **Missing** — no user-owned metadata update API/service            | Not applicable as a separate Library membership row; ownership itself supplies membership | **Missing** for users. Reusing current Catalog delete is **Unsafe / unauthorized** for Personal Work                  | Reader open only when ready; no Personal management menu is supported.                                          |
| Saved Catalog Work | **Available** — existing Discover detail route/API                                       | **Missing** to Library users; Catalog metadata patch is Admin-only | **Available** — remove explicit Library membership                                        | Not a user Library action; deleting the underlying Work is **Unsafe** as a substitute and Admin-only/unpublished-only | Read when ready and remove membership are supported; detail is available through the existing Discover surface. |

For the requested card menu, the only current Library management operation is **Remove from Library** for saved Catalog Works. An Edit, Personal Delete, or Retry action would be unsupported today.

## 9. Backend Gaps

1. No explicit Personal-vs-Catalog source discriminator in `LibraryItem`.
2. No Library source filter; the merged response is limited to 48 before a client can filter it.
3. No authenticated Personal metadata update endpoint/service, and no Personal cover update contract.
4. No authenticated Personal delete lifecycle, including active-job cancellation/fencing, lease coordination, complete transient-asset cleanup, and a defined reading-history/conversation policy for Personal deletion.
5. No user-facing Personal retry capability. Existing Catalog workflow retry is Admin-only; failed status must not be presented as retryable from Library.

## 10. Recommended Next Implementation Scope

For the requested Library tabs, make one narrow contract change: return `source: 'personal' | 'catalog'` on each Library item and accept an optional matching source filter on `GET /api/library`, applying it before the existing item limit. The UI can then implement 全部 / 我的上传 / 已收藏 and keep Continue Reading as a separate reading-state projection.

Keep Personal Edit/Delete out of the card menu until separately scoped backend capabilities exist. Do not map the Admin Catalog update/delete/retry operations onto Personal Works. Saved Catalog detail, Reader navigation, and membership removal already have supporting capabilities.

### Evidence paths

- `apps/backend/src/domains/library/routes/index.ts`, `apps/backend/src/domains/library/service.ts`
- `packages/shared/src/library/library.ts`, `apps/web/features/library/library-api.ts`, `apps/web/features/library/library-book-card.tsx`
- `apps/backend/src/domains/works/routes/personal.ts`, `apps/backend/src/domains/works/personal/personal-epub-upload.ts`
- `apps/backend/src/domains/works/routes/admin.ts`, `apps/backend/src/domains/works/admin/admin-work-write.ts`, `apps/backend/src/application/commands/delete-work.ts`
- `apps/backend/src/domains/ingest/epub/work-upload.ts`, `apps/backend/src/domains/ingest/parser/`, `apps/backend/src/application/commands/run-content-parse-workflow.ts`
- `packages/db/src/schema.ts`, `apps/backend/src/domains/reading/history/query.ts`
- `apps/backend/src/domains/works/routes/catalog.ts`, `apps/backend/src/domains/works/catalog/catalog.ts`, `apps/web/app/(app)/discover/[workId]/page.tsx`
- `docs/adr/001-reading-content-domain-model.md`, `docs/product/engineering-vocabulary.md`
