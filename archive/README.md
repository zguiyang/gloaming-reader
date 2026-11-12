# Archived legacy delivery (N5 demote)

The **default open-source product path** is the **repository root** (single Next
package: UI + Route Handlers + optional `jobs/` worker; contracts in `shared/`
and `i18n/`). This tree keeps the former three-service layout and former
workspace packages for **comparison and rollback reference only**.

| Path | Former role |
| ---- | ----------- |
| `archive/apps/web` | Next.js UI (proxied `/api/*`) |
| `archive/apps/backend` | Hono API + BullMQ worker |
| `archive/packages/*` | `@gloaming/shared`, `@gloaming/db`, `@gloaming/i18n` |

These directories are **not** part of the live install. Do not treat them as the
supported default.

See [`docs/LOCAL_RUN.md`](../docs/LOCAL_RUN.md) for the supported local runbook.
