# Archived legacy delivery (N5 demote)

The **default open-source product path** is the repo root workspace (`client/` — Next UI + Route Handlers + `jobs/` worker). This tree keeps the former three-service layout for **comparison and rollback reference only**.

| Path | Former role |
| ---- | ----------- |
| `archive/apps/web` | Next.js UI |
| `archive/apps/backend` | Hono API + BullMQ worker |
| `archive/packages/*` | `@gloaming/shared`, `@gloaming/db`, `@gloaming/i18n` for the legacy stack |

These directories are **not** members of the root `pnpm` workspace. To install or run the legacy stack temporarily, restore workspace entries under `archive/` in a branch or use a one-off workspace config — do not treat this as the supported default.

See [`docs/LOCAL_RUN.md`](../docs/LOCAL_RUN.md) for the supported local runbook.
