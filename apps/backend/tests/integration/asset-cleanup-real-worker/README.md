# Real Worker integration — asset cleanup

Live harness that spawns a one-shot **Worker** process (not Vitest mocks) and exercises async asset cleanup against real Redis, PostgreSQL, and S3-compatible storage.

## How to run

From the repository root:

```bash
pnpm test:backend:integration
```

From `apps/backend`:

```bash
pnpm test:integration:worker
```

These commands run `main.ts` via `tsx` only. They do **not** start `dev`, `start`, `preview`, or `dev:worker` watch modes.

## Default backend tests

`pnpm test:backend` runs Vitest with `tests/**/*.spec.ts` only. This harness is **not** included. A green default backend test run does not imply the real Worker path was exercised.

## Isolation contract

The harness loads `apps/backend/.env` then `.env.test`, then enforces:

| Resource       | Requirement                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL     | `TEST_DATABASE_URL` → database name **`gloaming_test`** only                                                         |
| Redis          | URL forced to **DB index 1** (never DB 0, to avoid clashing with local dev Worker)                                   |
| Object storage | Test bucket and endpoint from `.env.test`; must **not** be `gloaming-development`                                    |
| S3 keys        | Writes only under `asset-it-<run-id>/` for the run; teardown removes created objects, DB rows, and Redis/BullMQ keys |

If isolation checks fail, the run exits with `BLOCKED` and does not mutate shared dev resources.

Prerequisites: migrated `gloaming_test`, reachable Redis, and test S3/R2 credentials as configured in `.env.test`. Run `pnpm db:migrate:test` from the repo root when the test schema is behind.

## Scenarios

| ID    | Name                                        | Status                                                                                |
| ----- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| **A** | Normal cleanup via real Worker              | **Run** — happy path through live Worker + admin API                                  |
| **B** | Second reconciliation while cleanup pending | **Run** — concurrency/reconcile behavior with real queue                              |
| **C** | Partial delete failure + retry              | **NOT RUN** — no safe delete-failure injection on live R2/S3 without production hooks |
| **D** | Dual-worker lock fencing                    | **NOT RUN** — dual-Worker timing cannot be orchestrated safely without invasive hooks |

Scenarios C and D are reported explicitly as `NOT RUN` in the JSON report (see `scenarios-not-run.ts`). Behavior is covered elsewhere:

- `tests/unit/domains/assets/cleanup-job.spec.ts` — partial delete failures, retryable status, stale worker / lock ownership
- `tests/unit/domains/assets/cleanup-store.spec.ts` — owned save script / lock store
- Functional tests use `MemoryObjectStore` for failure injection, not live object storage

## Output

On completion, the harness prints `REAL WORKER INTEGRATION REPORT` (JSON) and exits `0` on `PASS`, non-zero otherwise.
