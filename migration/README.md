# migration/

Extract staging tree for the next Gloaming repo root. Contents of this directory are intended to become the new repository root later.

## Layout

- `client/` — Next.js app (**UI + all HTTP APIs** + same-package Jobs at `client/jobs/`). Target tree: [`client/STRUCTURE.md`](./client/STRUCTURE.md).
- `packages/` — transitional workspace packages (`shared`, `i18n`). **No `packages/db`** — schema is inlined at `client/server/db/`. See [`packages/README.md`](./packages/README.md).
- [`LOCAL_RUN.md`](./LOCAL_RUN.md) — local dual-process runbook + smoke checklist.

**In-app vs package shared:** UI↔server contracts used only inside the Next app live in `client/shared/`. Cross-package / extractable contracts live in `packages/*`. Prefer inlining single-consumer modules (e.g. db) into `client/`.

## Commands

```bash
cd migration
bun install   # or pnpm install — see LOCAL_RUN.md if pnpm extract fails
pnpm --filter @gloaming/client db:migrate
pnpm --filter @gloaming/client dev
pnpm --filter @gloaming/client dev:jobs
```

Do not point the new client at root `packages/*` via permanent `file:` deps.

## Status (local cutover)

- N3 UI + N4 Route Handlers + worker: local path ready (compare old `apps/*`).
- T1 AI SDK + T2 Azure Speech REST on migrated paths.
- **Not done:** N5 slim/delete old apps, P4 Cloudflare Workers.
