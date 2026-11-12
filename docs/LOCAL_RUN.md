# Local full-stack runbook (`client`)

Run the **new** tree locally: Next (UI + Route Handlers) + same-package BullMQ worker.  
**Not** Cloudflare / vinext / OpenNext (that is P4). Legacy `archive/apps/web` + `archive/apps/backend` remain for comparison (N5 demote).

## Processes

| Old (three)                        | New (two)                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| `archive/apps/web` (Next)          | `client` Next — UI **and** `/api/*`                                              |
| `archive/apps/backend` HTTP (Hono) | _(folded into Next Route Handlers)_                                              |
| `archive/apps/backend` worker      | `pnpm --filter @gloaming/client jobs` (`client/jobs/`; second OS process; `tsx`) |

Shared data plane: Postgres + Redis + S3 (same as today).

## Prerequisites

1. From **repo root**, start data services:

```bash
docker compose up -d
```

Default compose ports used by `client/.env.example`:

- Postgres `127.0.0.1:5433` → container `5432`
- Redis `127.0.0.1:6380` → container `6379`

2. Copy env and fill secrets:

```bash
cp client/.env.example client/.env
```

Required: `DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`, `FRONTEND_URL=http://localhost:3000`, S3 keys, `LLM_CONFIG_ENCRYPTION_KEY`.  
Optional: Resend, GitHub OAuth, Azure TTS / LLM provider credentials for AI paths.  
**Do not** set `API_INTERNAL_URL` — APIs are same-origin `/api/*`.  
Open the app with the same host as `FRONTEND_URL` when possible (`localhost` vs `127.0.0.1`); local auth also trusts the swap and ports 3000/3001.  
Ensure `client/public/gloaming-mark.png` is present (copied from `archive/apps/web/public` if needed).

3. Install from **repo root**. Prefer Bun if Cursor sandbox blocks pnpm extracts that ship `.idea` / `.claude` dirs:

```bash
bun install
# or: pnpm install
```

4. Migrate DB (schema lives in **`client/server/db`**, not `packages/db`):

```bash
pnpm --filter @gloaming/client db:migrate
# or from client/: bun run db:migrate
```

## Start

Two terminals from repo root:

```bash
pnpm --filter @gloaming/client dev
pnpm --filter @gloaming/client dev:jobs
```

Jobs runtime uses **`tsx`** against `jobs/worker.ts` (no Next bundling):
`node --import tsx` for one-shot runs, `tsx watch` for `dev:jobs`. Package gate
is native TypeScript check (`tsc -p tsconfig.jobs.json`); workspace packages
still ship `.ts` sources, so start stays on the tsx loader:

```bash
pnpm --filter @gloaming/client build:jobs
pnpm --filter @gloaming/client start:jobs
```

(`dev:worker` / `worker` remain aliases of `dev:jobs` / `jobs`.)

- UI: http://localhost:3000
- Health: `GET /api/health/live`, `GET /api/health/ready`
- Auth: `GET|POST /api/auth/*` (Better Auth via Next handler)
- Session: `GET /api/me`

## Smoke checklist

| Check               | How                                        | Needs                                                                               |
| ------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| Install + typecheck | `pnpm --filter @gloaming/client typecheck` | —                                                                                   |
| Build               | `pnpm --filter @gloaming/client build`     | Do **not** put `NODE_ENV=development` in `.env` (breaks `/_global-error` prerender) |
| Live                | curl `/api/health/live`                    | Next up                                                                             |
| Ready               | curl `/api/health/ready`                   | Postgres + Redis                                                                    |
| Auth                | sign-up / sign-in in UI                    | mail/dev links as configured                                                        |
| Discover            | `/discover`                                | DB data                                                                             |
| Library             | `/library` + upload EPUB                   | auth + S3 + **worker**                                                              |
| Read                | `/read/[workId]`                           | parsed work                                                                         |
| Assist SSE          | reader assist once                         | LLM keys                                                                            |
| TTS                 | reader audio / admin TTS test              | Azure Speech keys                                                                   |
| Admin               | `/admin` + one config tab                  | admin user                                                                          |
| Worker ping         | `POST /api/admin/jobs/ping`                | admin + worker + Redis                                                              |

## Package placement (this cutover)

| Module                 | Placement                                               | Why                                                  |
| ---------------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| DB schema / migrations | `client/server/db/` (inlined)                           | Only server consumer in new tree                     |
| UI↔server contracts    | Prefer `client/shared/`; `packages/shared` transitional | Do not expand packages/shared for app-only contracts |
| i18n                   | `packages/i18n`                                         | Large import surface; keep transitional package      |

## Consolidation docs (this wave)

| Doc                                                          | Purpose                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------- |
| [`PROCESS_COMPARE.md`](./PROCESS_COMPARE.md)                 | Old three-process vs new two-process                                |
| [`T3-DEPENDENCY-INVENTORY.md`](./T3-DEPENDENCY-INVENTORY.md) | Workers-hostile deps inventory (input to P4, not a readiness claim) |
| [`RATE_LIMIT.md`](./RATE_LIMIT.md)                           | Better Auth + Next guest/AI rate-limit strategy                     |

## Known gaps / deferred

- Legacy Hono / LangChain / Speech SDK sources were removed from the extract tree (not mounted; compare against `apps/backend` if needed).
- Assist tools are live AI SDK tools (`get_part_slice` / `search_part` / dictionary via `createPartAssistTools`) — **not** LangChain. AI invoke/stream uses Vercel AI SDK (T1). TTS uses Azure Speech REST (T2).
- API rate limits: Next helpers on assist / translate / dictionary guest (`next-rate-limit.ts`); see [`RATE_LIMIT.md`](./RATE_LIMIT.md).
- Worker is still BullMQ + Redis (Node process) — acceptable for local open-source; **not** claimed Workers-compatible (P4 / R5 still open).
- Some smoke paths may fail without LLM / Azure / S3 keys — tolerate and continue; do not treat partial smoke as N5/P4 go-ahead.
- N5 (delete/slim old apps) and P4 (CF) are **out of scope**.
- Install: Cursor may block pnpm extracting packages with `.idea`; Bun + vendored `iconv-lite` is the local workaround.

## Verification already done in-tree

- `bunx tsc --noEmit` in `client` — re-run after consolidation edits
- `bun run build` (`NODE_ENV=production next build`) — previously pass; re-run if packaging changes
- Live compose smoke depends on your local Docker + `.env` secrets
