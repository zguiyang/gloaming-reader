# Run on a VPS (Node)

Postgres and Redis run in Docker Compose. The Hono **API** and the BullMQ
**worker** are two independent Node processes on the host. Do not treat them as
one process. Containerizing those processes can wait; see
[`deploy-targets.md`](./deploy-targets.md) for the deferred dual-runtime plan.

## Prerequisites

- Node.js 24+
- pnpm
- Docker

## Secrets and configuration (do not commit)

- Copy [`apps/backend/.env.example`](../apps/backend/.env.example) →
  `apps/backend/.env` and [`apps/web/.env.example`](../apps/web/.env.example) →
  `apps/web/.env` (or the host’s secret store). Fill real values only on the
  server.
- **Never** commit `apps/backend/.env`, `apps/web/.env`, production configs, or
  a local `docker-compose.yaml` (use `pnpm compose:init` from the example).
- **Never** paste API keys, passwords, database URLs with credentials, or other
  secrets into this document, tickets, or git history.
- Variable **names** live in the `.env.example` files. Values stay on the host.

API and Worker import `env`, which runs Zod validation at module load. Missing
or invalid config exits the process immediately — before listen. There is no
separate `validate:env` command and no `prestart` / `preworker` hook.

### Notable variable names (values not documented here)

| Area                           | Names (see examples)                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Backend core                   | `DATABASE_URL`, `REDIS_URL`, `FRONTEND_URL`, `BETTER_AUTH_SECRET`, `HOST`, `PORT`                          |
| Mail (Resend)                  | `RESEND_API_KEY` (required), `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME`                                         |
| Object storage (S3-compatible) | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` |
| Web → API                      | `API_INTERNAL_URL` (required; Hono origin for Next `/api` rewrites)                                        |

On the VPS, set backend `HOST=0.0.0.0` and point `DATABASE_URL` / `REDIS_URL` at
the Compose published ports (local example ports: `5433` / `6380`). Set web
`API_INTERNAL_URL` to the reachable Hono origin (for example
`http://127.0.0.1:3333` when Next and the API share the host).

## Process model

| Process | Command (after build)                    | Role                                 |
| ------- | ---------------------------------------- | ------------------------------------ |
| API     | `pnpm --filter @gloaming/backend start`  | HTTP / Better Auth / enqueues jobs   |
| Worker  | `pnpm --filter @gloaming/backend worker` | Consumes the `gloaming` BullMQ queue |

- Scripts run `node --import tsx dist/index.js` / `dist/worker.js` so workspace
  packages that export TypeScript source resolve under Node.
- The API **only enqueues**. Background work does not run inside the API
  process.
- The worker **must keep running** and **must auto-restart** on crash (systemd
  `Restart=`, pm2, or equivalent). A stopped worker silently stalls TTS, ingest,
  and other queued work.
- Smoke path for the queue: authenticated admin
  `POST /api/admin/jobs/ping`.

## Admin bootstrap (first registrant)

There is **no** `seed:admin` script. When the user table is empty, the **first
successful registration** becomes `admin`. Later signups are normal users.

Before the first production registration, the operator must confirm the
database has **zero** users. Do not open public registration until go-live
checks pass; the operator registers the admin account deliberately.

## Go-live sequence (required order)

Complete these steps in order. Do not open public registration until the final
step.

### 0. Host prep (once per machine)

```bash
pnpm install
pnpm compose:init
docker compose up -d   # Postgres + Redis only
```

Do **not** use `pnpm install --prod` (or omit devDependencies) on the host.
`start` / `worker` run `node --import tsx dist/...`, and `tsx` is currently a
backend **devDependency**. A production-only install will fail at runtime with a
missing `tsx` module. Use a full workspace install (as above) until `tsx` moves
to `dependencies` or the build stops relying on it.

Configure backend and web env files on the host (see above). Do not commit them.

### 1. Build

```bash
pnpm build:backend
# When serving Next on the same host:
# pnpm --filter @gloaming/web build
```

### 2. Database migrate

```bash
pnpm db:migrate
```

### 3. Confirm empty user table (pre-registration)

Confirm `user` has **0** rows on the target database (operator/DBA only). Do not
print connection strings or credentials.

### 4. Start API

```bash
pnpm --filter @gloaming/backend start
```

Importing `env` validates config via Zod at startup. Keep this process
supervised (systemd/pm2).

### 5. Start worker (supervised, auto-restart)

```bash
pnpm --filter @gloaming/backend worker
```

Importing `env` validates config via Zod at startup. Ensure the unit/process
manager restarts the worker on failure.

### 6. Register the first admin (product UI)

Start or reload the web app with a correct `API_INTERNAL_URL`. Register the
first account through the product UI while the database is still empty. That
account receives the admin role. Sign in and confirm admin access.

### 7. Worker smoke: `POST /api/admin/jobs/ping`

With an admin session, call `POST /api/admin/jobs/ping`. Expect a successful
enqueue/response and a matching worker log for the ping job. Failure usually
means Redis, worker down, or missing admin auth — not “API alone is healthy.”

### 8. Verify Resend, S3-compatible storage, and Redis (real connectivity)

Zod env checks prove **shape**, not live connectivity. Before go-live:

| Dependency            | What to verify (no secrets in logs)                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Redis                 | Queue ping above succeeds; Redis container/process healthy                                                                |
| Resend                | Trigger a real transactional path (e.g. email verification or password reset) and confirm delivery                        |
| S3-compatible storage | Exercise an upload/read path that persists a content asset or part audio; confirm object appears in the configured bucket |

### 9. Verify the core reading path

As a signed-in user (admin is fine for this check):

1. Open or ingest a reading work available in this environment.
2. Open the reader for a part; content loads.
3. Confirm dictionary lookup and AI Assist return real results (LLM, not mock).
4. Confirm audio generation/playback that depends on the worker + S3-compatible storage.

Stop and fix failures before inviting the public.

### 10. Open registration

Only after steps 1–9 pass. Until then, keep the deployment off public traffic
(firewall, reverse-proxy allowlist, or equivalent). After the first admin
exists, further sign-ups receive a normal user role.

## Process manager sketches

systemd — two units, same working directory, different `ExecStart`, both with
restart:

```text
ExecStart=/usr/bin/pnpm --filter @gloaming/backend start
ExecStart=/usr/bin/pnpm --filter @gloaming/backend worker
# Restart=on-failure (or always) on both units
```

pm2, from `apps/backend` after build:

```bash
pm2 start pnpm --name gloaming-api -- --filter @gloaming/backend start
pm2 start pnpm --name gloaming-worker -- --filter @gloaming/backend worker
```

Package scripts import `env` and run Zod validation at module load.

## Out of scope here

- Local `dev:*` workflows
- Putting the API or worker into Compose until you intentionally containerize
  them
- Cloudflare Workers dual-runtime (see `deploy-targets.md`)
