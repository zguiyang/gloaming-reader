# `server/` — server-only domain and infrastructure

Logical server modules inside the Next deployable. HTTP transport stays thin in `app/api/**/route.ts`.

| Path           | Role                                                              |
| -------------- | ----------------------------------------------------------------- |
| `domains/`     | Business capabilities (server-only; no HTTP framework types)      |
| `infra/`       | Auth, DB, cache, storage, LLM, TTS adapters — no domain workflows |
| `application/` | Optional orchestration (e.g. job-related); empty until authorized |

**May import:** `@/shared`, `@/i18n`, and `server/infra` (not `features/`).

**Must not:** leak into `features/` or client bundles; do not nest Hono as the long-term API host.

Fill during **N4**. See [STRUCTURE.md](../STRUCTURE.md).
