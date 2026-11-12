# Archived legacy delivery (N5 demote)

The **default open-source product path** is repo-root **`client/`** (Next UI +
Route Handlers + `jobs/` worker; contracts in `client/shared/` and
`client/i18n/`). This tree keeps the former three-service layout and former
workspace packages for **comparison and rollback reference only**.

| Path | Former role |
| ---- | ----------- |
| `archive/apps/web` | Next.js UI (proxied `/api/*`) |
| `archive/apps/backend` | Hono API + BullMQ worker |
| `archive/packages/*` | `@gloaming/shared`, `@gloaming/db`, `@gloaming/i18n` |

These directories are **not** members of the root `pnpm` workspace. Do not treat
them as the supported default.

See [`docs/LOCAL_RUN.md`](../docs/LOCAL_RUN.md) for the supported local runbook.
