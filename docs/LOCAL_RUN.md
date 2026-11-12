# Local full-stack runbook

Run the live product locally: Next (UI + Route Handlers) + same-package BullMQ worker.  
**Not** Cloudflare / vinext / OpenNext (that is P4). Legacy `archive/apps/web` + `archive/apps/backend` remain for comparison only.

## Processes

| Old (three)                        | New (two)                                       |
| ---------------------------------- | ----------------------------------------------- |
| `archive/apps/web` (Next)          | Repo-root Next — UI **and** `/api/*`            |
| `archive/apps/backend` HTTP (Hono) | _(folded into Next Route Handlers)_             |
| `archive/apps/backend` worker      | `pnpm jobs` (`jobs/`; second OS process; `tsx`) |

Shared data plane: Postgres + Redis + S3.

## Prerequisites

1. From **repo root**, start data services:

```bash
docker compose up -d
```

Default compose ports used by `.env.example`:

- Postgres `127.0.0.1:5433` → container `5432`
- Redis `127.0.0.1:6380` → container `6379`

2. Copy env and fill secrets:

```bash
cp .env.example .env
```

Required: `DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`, `FRONTEND_URL=http://localhost:3000`, S3 keys, `LLM_CONFIG_ENCRYPTION_KEY`.  
Optional: Resend, GitHub OAuth, Azure TTS / LLM provider credentials for AI paths.  
**Do not** set `API_INTERNAL_URL` — APIs are same-origin `/api/*`.  
Open the app with the same host as `FRONTEND_URL` when possible (`localhost` vs `127.0.0.1`); local auth also trusts the swap and ports 3000/3001.  
Ensure `public/gloaming-mark.png` is present.

3. Install from **repo root** with pnpm:

```bash
pnpm install
```

4. Migrate DB (schema lives in **`server/db`**):

```bash
pnpm db:migrate
```

## Start

Two terminals from repo root:

```bash
pnpm dev
pnpm dev:jobs
```

Jobs runtime uses **`tsx`** against `jobs/worker.ts` (no Next bundling):
`node --import tsx` for one-shot runs, `tsx watch` for `dev:jobs`. Package gate
is native TypeScript check (`tsc -p tsconfig.jobs.json`); start stays on the tsx
loader:

```bash
pnpm build:jobs
pnpm start:jobs
```

(`dev:worker` / `worker` remain aliases of `dev:jobs` / `jobs`.)

- UI: http://localhost:3000
- Health: `GET /api/health/live`, `GET /api/health/ready`
- Auth: `GET|POST /api/auth/*` (Better Auth via Next handler)
- Session: `GET /api/me`

## Smoke checklist

Use the interactive browser or curl against `http://localhost:3000` for:

1. Home / marketing shell loads
2. Sign-up / sign-in (email) when mail is configured (or accept auth-path limits)
3. Library empty or seeded state
4. Discover browse (catalog)
5. Open a work / reader shell
6. One assist or dictionary call if LLM keys exist (optional)
7. Jobs: enqueue a path that needs the worker and confirm `pnpm jobs` consumes it

## Notes

- Legacy Hono / LangChain / Speech SDK sources live under `archive/` only.
- Assist tools are live AI SDK tools — **not** LangChain. TTS uses Azure Speech REST.
- Worker is still BullMQ + Redis (Node process) — acceptable for local open-source; **not** claimed Workers-compatible (P4 / R5 still open).
- Some smoke paths may fail without LLM / Azure / S3 keys — tolerate and continue.

## Verification already done in-tree

- `pnpm typecheck` / `pnpm build:jobs` — re-run after packaging changes
- `pnpm build` — re-run if packaging changes
- Live compose smoke depends on your local Docker + `.env` secrets
