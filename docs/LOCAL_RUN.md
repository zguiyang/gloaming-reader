# Local full-stack runbook

Run the live product locally: Next (UI + Route Handlers) + same-package BullMQ worker.

## Processes

| Process               | Role                                     |
| --------------------- | ---------------------------------------- |
| Repo-root Next        | UI **and** `/api/*`                      |
| `pnpm jobs` (`jobs/`) | BullMQ worker (second OS process; `tsx`) |

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
- If outbound HTTPS calls (LLM providers, dictionary APIs, etc.) need a local proxy, set `http_proxy` / `https_proxy` (or the channel-specific proxy URL on the provider row in admin). The server uses the same undici proxy helper for all outbound fetches.
- This runbook does **not** use Cloudflare Workers, vinext, or OpenNext.
- Redis application keys must use TTLs (see [backend Redis key policy](../rules/backend.md#redis-key-policy)).

### After removing Discover / upload-only reset

Migrations:

- `0067_drop_discovery_tables` — drops discovery registry tables
- `0068_drop_personal_tag_preference` — drops unused `user_personal_tag_preference`

```bash
pnpm db:migrate
```

**Dev-only full content wipe** (books, library memberships, reading state, assets metadata, Redis content/queue/rate-limit keys, and objects in the configured development S3/R2 bucket). Keeps auth users and admin LLM/TTS/dictionary config. Stop `pnpm dev` / `pnpm jobs` first:

```bash
pnpm reset:content
```

Safety checks: local `DATABASE_URL` / `REDIS_URL` only; refuses `NODE_ENV=production`; S3 wipe requires a bucket name that looks like development (or `RESET_CONTENT_ALLOW_BUCKET=1`).

Do **not** `FLUSHDB` on Redis if you still need Better Auth secondary-storage keys (`better-auth:*`) — `reset:content` leaves those alone.
