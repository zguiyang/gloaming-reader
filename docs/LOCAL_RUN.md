# Local full-stack runbook

Run the live product locally: Next (UI + Route Handlers) + same-package BullMQ worker.  
Legacy `archive/apps/web` + `archive/apps/backend` remain for comparison only.

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

3. Install and migrate:

```bash
pnpm install
pnpm db:migrate
```

## Run

```bash
pnpm dev          # Next on :3000
pnpm jobs         # BullMQ worker (second terminal)
```

Optional: `pnpm build && pnpm start` for production-mode local check.

## Notes

- Auth, TTS, LLM, and storage need the corresponding keys in `.env` (see `.env.example`).
- This runbook does **not** use Cloudflare Workers, vinext, or OpenNext.
- Redis application keys must use TTLs (see [backend Redis key policy](../rules/backend.md#redis-key-policy)). Scan leftovers with `pnpm exec tsx scripts/redis-no-ttl-scan.ts`.
