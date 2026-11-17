# Bounded Discover catalog index (design)

**Status:** Accepted direction (product) — backend + admin UI + local Discover read wired  
**Date:** 2026-11-17  
**Related:** live on-demand Gutenberg OPDS Discover; archived RDF sync under `archive/apps/backend`; AGENTS “do not revive Gutenberg **full** sync as the main discovery path”

## 1. Goal

Keep Discover browsable and Save on-demand, without:

- pre-loading EPUB / illustrations into object storage, or
- depending on live `www.gutenberg.org` OPDS for every list request.

**Cost rule**

| Layer              | When written                     | What is stored                                        |
| ------------------ | -------------------------------- | ----------------------------------------------------- |
| Thin catalog index | Scheduled / manual sync          | Metadata + remote cover/EPUB URLs only                |
| Thick content      | User Save / materialization only | EPUB bytes in object storage, parse assets, Work rows |

Browsing never writes object storage. Index size is capped so Postgres stays within a **≤ 100 MB** budget for Discover index data (conservative for free-tier DBs).

This is **not** “full Gutenberg as the product.” It is a **bounded metadata index** for Discover, with content fetch strictly on Save.

## 2. Current state (baseline)

- Discover list/detail for `project_gutenberg` call live OPDS (`listGutenbergOpdsRecords` / `getGutenbergOpdsRecord`).
- Save already materializes on demand (`downloadGutenbergEpub` → object storage → Work).
- `source_record` already models thin bibliographic rows (no file bytes). Cover is a URL, not a stored asset.
- `discovery_source` still has dormant sync-status columns; `discovery_sync_run` was dropped in migration `0059_on_demand_discovery_cleanup`.
- Admin `/admin/discovery-sources` only toggles `enabled`. Archive UI had sync-run panels worth restoring in spirit.

## 3. Target architecture

```
┌─────────────────┐     schedule / admin enqueue      ┌──────────────┐
│  pg_catalog.csv │ ────────────────────────────────► │ jobs worker  │
│  (weekly dump)  │     metadata only, no EPUB        │ ingest+promote│
└─────────────────┘                                   └──────┬───────┘
                                                             │
                                    ┌────────────────────────┼────────────────────────┐
                                    ▼                                                 ▼
                         discovery_catalog_entry                           source_record (≤ maxRows)
                         (staging, not Discover)                           Discover index + eviction
                                    │                                                 ▲
                                    └──────── Top-N promote ──────────────────────────┘
┌─────────────────┐     read local index
│ Discover UI/API │ ◄── source_record only
└────────┬────────┘
         │ Save
         ▼
┌─────────────────┐     download EPUB (mirrors later) ┌──────────────┐
│ materialization │ ────────────────────────────────► │ object store │
└─────────────────┘                                   └──────────────┘
```

**Read path:** `GET /api/discover/records` queries local `source_record` (enabled source), not live OPDS.  
**Write path (Save):** unchanged semantics — download when the user adds to Library.  
**Sync path:** jobs process only; never downloads EPUB; never writes object storage.

## 4. Data model

### 4.1 Reuse `source_record` as the Discover index

One row per `(source_id, external_id)` remains the **Discover** index (bounded by `maxRows`).

Required for ranking / eviction:

- `popularityScore` (int, default 0) — CSV v1 derives from `Issued`; later may overlay RDF `downloads`.
- Keep existing `lastSeenAt`, `sourceUpdatedAt`, `contentCandidates`, `coverUrl`, languages, authors, etc.

### 4.1b Staging: `discovery_catalog_entry`

Thin upstream staging (sync input, **not** a public Discover API). Holds filtered CSV (later RDF) rows for the source; promote copies Top-N into `source_record`. Unique on `(source_id, external_id)`; indexed by `(source_id, popularity_score)`.

Optional later (not v1): FTS index on title/authors.

### 4.2 Per-source sync settings on `discovery_source`

Extend the source row (or a JSON `sync_config` column — prefer explicit columns for v1 clarity):

| Setting           | Default             | Meaning                                                         |
| ----------------- | ------------------- | --------------------------------------------------------------- |
| `enabled`         | true                | Source visible in Discover; when on, scheduled sync may enqueue |
| `maxRows`         | **10000**           | Hard cap of index rows for this source                          |
| `languages`       | `['en']`            | Only index records that include at least one listed language    |
| `requireEpub`     | true                | Skip records with no selectable EPUB candidate URL              |
| `evictionPolicy`  | `hot_swap`          | `hot_swap` \| `freeze_inserts`                                  |
| `budgetBytesHint` | 104857600 (100 MiB) | Soft budget for admin warning / sync failure if exceeded        |

Schedule is a **code default** (weekly Sunday 02:00 UTC) — not an admin-editable field in MVP. Outages are handled by sync failure + backoff, not a second human toggle.

Sync status columns already on the table (`syncStatus`, `lastSuccessAt`, `lastErrorSummary`, snapshot validators) are **reactivated**, not redesigned.

### 4.3 Sync run history

Reintroduce a lean `discovery_sync_run` (shape can follow archive, trimmed):

- identity: `sourceId`, `claimToken` / run id
- lifecycle: `queued` → `downloading` → `processing` → `succeeded` \| `not_modified` \| `failed` (plus `skipped` if disabled)
- counters: considered, upserted, refreshed, inserted, evicted, skipped_filter
- `errorSummary` (sanitized)
- timestamps

Retain a bounded history (e.g. last 20–50 runs per source) via cleanup on insert or periodic trim.

## 5. Sync algorithm (Project Gutenberg v1)

**Upstream (v1):** official weekly `pg_catalog.csv.gz` (PGLAF mirror preferred). EPUB/cover URLs use Project Gutenberg conventions. RDF dump remains available for a future `downloads` overlay into staging — **not** the Discover hot path. Never crawl HTML/OPDS for bulk index.

**Per run**

1. Claim source (`idle`/`failed`/`succeeded` → `queued`/`syncing`); create sync-run row.
2. Download CSV with timeout + `If-Modified-Since` when available → `not_modified` exit.
3. Parse Text rows; apply filters: language whitelist, `requireEpub`; upsert into `discovery_catalog_entry`.
4. Select Top-N from staging by `popularityScore` desc.
5. **Atomic promote** into `source_record` (one DB transaction): upsert Top-N + `hot_swap` eviction of unprotected rows outside the set + row-count budget check. On failure the transaction rolls back — Discover never keeps a partial promote. Staging writes stay outside this transaction (non-product).
6. Soft budget uses `rowCount × 2KiB` (stable); hard admission remains `maxRows`. **Do not** use `pg_total_relation_size` for the gate.
7. Mark source + run terminal status.

**Row protection (must not hot-swap away)**

Do not evict a `source_record` that has:

- non-null `workId`, or
- `materializationStatus` in (`processing`, `ready`), or
- any non-terminal Save Intent

Protected rows count toward `maxRows`. If the protected set alone exceeds `maxRows`, sync fails loudly (admin must raise cap or clean up) — do not delete user-linked rows.

**Startup defaults:** `maxRows = 10000`, languages `en`, `hot_swap`. Expected size for lean rows + indexes: on the order of **tens of MB**, well under 100 MB. Raise `maxRows` only after measuring.

## 6. Discover / Save behavior changes

| API / flow                      | After this design                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/discover/records`     | Local `source_record` query (sort/filter/page). Empty index → empty list (not OPDS 502).                                     |
| `GET /api/discover/records/:id` | Local row only (v1).                                                                                                         |
| Facets                          | Derive from indexed `sourceMeta` / shelves present in the bounded set, or keep static bookshelf map filtered to indexed ids. |
| Save / materialize              | Unchanged: download EPUB from candidate URL(s). Follow-up: multi-mirror download failover (separate task).                   |
| Object storage                  | Still only on materialization.                                                                                               |

**Degraded UX:** if sync is stale and upstream dump is down, Discover still serves the last good index. Save may fail with `SOURCE_UNAVAILABLE` until mirrors/upstream recover.

## 7. Admin UI / API

Extend existing Admin → Discovery sources (not a separate product surface).

**Per source**

- Enable / disable Discover (`enabled`) — also gates scheduled sync
- Edit `maxRows` (MVP admin); languages / `requireEpub` / `evictionPolicy` stay code defaults until needed
- Show: row count, last success, last error, sync status, soft budget hint
- Action: **Run sync now** (enqueue job; idempotent while one run active)
- Panel: recent run history (dialog)

**API sketch (names illustrative)**

- `GET /api/admin/discovery/sources` — summary + sync settings + counts
- `PATCH /api/admin/discovery/sources/:sourceKey` — enabled + sync settings
- `POST /api/admin/discovery/sources/:sourceKey/sync` — enqueue
- `GET /api/admin/discovery/sources/:sourceKey/sync/runs` — history
- `GET /api/admin/discovery/sources/:sourceKey/sync/progress` — current run (optional SSE later)

Public Discover APIs stay free of admin sync fields.

## 8. Jobs / ops

- Worker: `pnpm jobs` consumes a dedicated discovery-sync job (reuse archive job naming where practical).
- Schedule: weekly Sunday 02:00 UTC (code default; CSV upstream is weekly); skip if source disabled. Admin-configurable cron is out of MVP.
- Timeouts: hard wall clock per run (~15 min for CSV + promote).
- Observability: structured logs + `lastErrorSummary`; never log credentials or raw dump bodies.

## 9. Alignment with AGENTS.md

| Constraint                                                           | How this design complies                                                                                                          |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Do not revive Gutenberg **full** sync as the **main** discovery path | Index is **bounded** (`maxRows`), English/EPUB filtered; product remains AI-native reading + on-demand Save, not a full PG mirror |
| Live product = repo-root Next + optional `jobs/`                     | Sync runs in `jobs/`; APIs stay Route Handlers                                                                                    |
| No object-storage pre-seed                                           | Sync never downloads EPUB                                                                                                         |

## 10. Implementation phases

1. **Schema + settings** — popularity column; sync settings on `discovery_source`; recreate `discovery_sync_run`; shared Zod contracts.
2. **Sync worker** — RDF/CSV ingest, filters, `maxRows` + `hot_swap`, protection rules; admin enqueue + history APIs.
3. **Discover read cutover** — list/detail from DB; remove live OPDS from the hot path (keep client code only if still used for optional enrich).
4. **Admin UI** — settings form, run now, run history panel.
5. **Hardening (follow-up)** — EPUB download mirror pool; index size reporting; raise `maxRows` playbook.

## 11. Explicit non-goals (v1)

- Mirroring or caching EPUB/cover bytes into object storage during sync
- Indexing all ~80k Gutenberg records by default
- Replacing personal upload flows
- Standard Ebooks as a second source (optional later source adapter)
- Making public Gutendex.com a hard dependency

## 12. Default numbers (locked for v1)

| Knob                     | Value                 |
| ------------------------ | --------------------- |
| `maxRows`                | 10_000                |
| Languages                | `en`                  |
| Eviction                 | `hot_swap`            |
| Soft DB budget for index | 100 MiB               |
| History retention        | last 30 runs / source |

Change defaults only via admin (or migration) after measuring production row width × count.
