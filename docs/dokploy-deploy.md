# Production deploy (Dokploy + Docker)

Containerized production path for Gloaming: **web**, **api**, and **worker** as
Docker services. **PostgreSQL** and **Redis** are **external** — they are not
created by the production Compose file.

For host Node + systemd/pm2, see [`vps-run.md`](./vps-run.md). For deferred
Cloudflare Workers dual-runtime, see [`deploy-targets.md`](./deploy-targets.md).

## Architecture

```text
Internet ──► Dokploy Domain / Traefik ──► web:3000 (Next.js)
                                              │
                                              │ API_INTERNAL_URL (Docker DNS)
                                              ▼
                                         api:3333 (Hono, internal only)
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    ▼                         ▼                         ▼
            PostgreSQL (external)      Redis (external)          worker (BullMQ)
```

| Service  | Image / Dockerfile        | Public? | Role                                       |
| -------- | ------------------------- | ------- | ------------------------------------------ |
| `web`    | `apps/web/Dockerfile`     | Yes     | Next.js; `/api/*` rewrites to internal API |
| `api`    | `apps/backend/Dockerfile` | No      | HTTP, Better Auth, job enqueue             |
| `worker` | `apps/backend/Dockerfile` | No      | BullMQ consumer (TTS, ingest, cleanup)     |

Do **not** assign a Dokploy public domain to `api` or `worker`. The browser
talks only to `web`; session cookies stay on the web origin.

Templates:

- [`docker-compose.production.yaml.example`](../docker-compose.production.yaml.example)
- [`apps/web/Dockerfile`](../apps/web/Dockerfile)
- [`apps/backend/Dockerfile`](../apps/backend/Dockerfile)

Local development Postgres/Redis remain in
[`docker-compose.yaml.example`](../docker-compose.yaml.example) only.

## Prerequisites

1. **Dokploy** (or compatible Compose host) with Traefik for HTTPS domains.
2. **Existing PostgreSQL 15+** reachable from the Compose network.
3. **Existing Redis** reachable from the Compose network.
4. **S3-compatible object storage** and **Resend** credentials (required at
   backend boot — see `apps/backend/.env.example`).
5. Repository connected to Dokploy (build context = repo root).

### Connecting to external Postgres / Redis

Set `DATABASE_URL` and `REDIS_URL` on **`api`** and **`worker`** to URLs that
resolve from inside the application containers:

| Deployment pattern             | Typical hostname / notes                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| DB on same VPS, host-published | Use the host gateway (`host.docker.internal` on Docker Desktop; on Linux use the host IP or `extra_hosts`) |
| Dokploy-managed database app   | Use the Dokploy internal service hostname on the shared network                                            |
| Managed cloud (RDS, Upstash…)  | Use the provider connection string; ensure outbound access                                                 |

**Never** commit connection strings or secrets. Inject values only through
Dokploy **Environment** / **Secrets**.

`FRONTEND_URL` must be the public **https** origin of the `web` service (the
Dokploy domain), for CORS, Better Auth, and email links.

## Dokploy variable injection

Configure variables per service in the Dokploy UI (or encrypted secrets store).
Names match [`apps/backend/.env.example`](../apps/backend/.env.example) and
[`apps/web/.env.example`](../apps/web/.env.example).

### `web` (required)

| Variable              | Purpose                                                |
| --------------------- | ------------------------------------------------------ |
| `API_INTERNAL_URL`    | `http://api:3333` — Docker DNS to the `api` service    |
| `NEXT_PUBLIC_APP_URL` | Public https origin (optional if same-origin suffices) |

### `api` and `worker` (required — same secret set on both)

| Area         | Variable names                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| Core         | `DATABASE_URL`, `REDIS_URL`, `FRONTEND_URL`, `BETTER_AUTH_SECRET`, `HOST`, `PORT`                                   |
| Mail         | `RESEND_API_KEY`, `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME`                                                             |
| LLM keys     | `LLM_CONFIG_ENCRYPTION_KEY`                                                                                         |
| Object store | `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, optional `S3_ENDPOINT` |

Recommended production values:

- `api`: `HOST=0.0.0.0`, `PORT=3333`, `NODE_ENV=production`
- `worker`: `HOST=0.0.0.0`, `NODE_ENV=production` (`PORT` satisfies shared env schema)

API and Worker import `env` at module load. Missing or invalid config **exits
immediately** — there is no separate validate command.

## Dokploy setup (summary)

1. Create a **Compose** application pointing at
   `docker-compose.production.yaml.example` (or a copied compose file in the
   repo).
2. Set build context to the **repository root** (Dockerfiles use monorepo paths).
3. Add environment variables / secrets for `web`, `api`, and `worker` as above.
4. Attach a **Domain** only to **`web`** (port `3000`). Leave `api` and `worker`
   without public domains.
5. Enable container restart policies (Compose `restart: unless-stopped`).

Traefik/Dokploy handles TLS termination; no hand-written public API hostname is
required.

## Deployment order (required)

Run steps in order. Do **not** open public registration until the final step.

### 1. Prepare external data stores

- Confirm PostgreSQL and Redis are running and reachable from the future app
  network.
- Back up PostgreSQL before first production migrate (see **Backup & rollback**).

### 2. Database migrate (one-off, not in Compose)

Migrations are **not** run by the application containers. Execute from a
trusted environment with `DATABASE_URL` set to production:

```bash
pnpm install
# DATABASE_URL must be set in the shell or apps/backend/.env on the operator host
pnpm db:migrate
```

Use a CI job, Dokploy one-shot task, or operator shell — not `api` / `worker`
startup. Do not run `seed:dev` in production.

### 3. Confirm empty user table (pre-registration)

Confirm the `user` table has **0** rows before the first registration. The
first successful signup becomes `admin`.

### 4. Deploy application stack

Deploy or redeploy the Compose stack so **`api`** and **`worker`** start with
full backend secrets, then **`web`** (Compose `depends_on` api health).

Suggested Dokploy order on first deploy: configure secrets → migrate (step 2) →
deploy compose → verify health.

### 5. Register the first admin (product UI)

With `web` reachable at `FRONTEND_URL`, register the first account through the
product UI while the user table is still empty.

### 6. Worker smoke: `POST /api/admin/jobs/ping`

As admin, call `POST /api/admin/jobs/ping`. Expect enqueue success and worker
logs. Failure usually means Redis down, worker stopped, or missing admin auth.

### 7. Verify integrations

| Dependency            | Check                                           |
| --------------------- | ----------------------------------------------- |
| Redis                 | Queue ping succeeds                             |
| Resend                | Real transactional email (verification / reset) |
| S3-compatible storage | Upload/read path for content or part audio      |
| TTS path              | Reader audio generation (see below)             |

### 8. Open registration

Only after steps 1–7. Until then, restrict public traffic (firewall, allowlist).

## TTS and Worker

- The **API only enqueues** jobs; it does not run TTS or long background work.
- The **`worker` service must stay running** with restart policy. If it stops,
  TTS, ingest, metadata, and cleanup jobs stall silently.
- TTS uses Azure Speech (via backend SDK), Redis cache (`gloaming:tts:v2:*`),
  and S3-compatible storage for persisted audio — all configured through backend
  env on **both** `api` and `worker`.
- Scale workers by adding `worker` replicas only after confirming Redis and DB
  connection limits; start with one worker.

## Backup and rollback boundaries

| Asset              | Backup / rollback notes                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL         | Operator-owned. Snapshot/backup **before** `pnpm db:migrate`. Roll back DB from backup if a migration must be reversed. |
| Redis              | Queue/cache data; usually not restored for app rollback. TTS cache repopulates.                                         |
| Object storage     | Operator-owned bucket versioning/lifecycle. Deletion jobs are async via worker.                                         |
| Application images | Dokploy/registry retains prior image digests. Roll back by redeploying a previous build.                                |
| Secrets            | Stored in Dokploy; not in git. Rotating secrets requires coordinated service restart.                                   |

**Compose rollback:** redeploy an earlier image tag for `web`, `api`, and
`worker`. Database schema may not downgrade automatically — plan migrations
accordingly.

**Out of scope for this stack:** creating Postgres/Redis containers, running
migrations inside `api`/`worker` startup, or committing `docker-compose.yaml`
with secrets.

## Runtime notes

- **`api` and `worker` share** [`apps/backend/Dockerfile`](../apps/backend/Dockerfile); Compose overrides `command`.
- **`tsx` at runtime:** workspace packages (`@gloaming/db`, `@gloaming/shared`)
  export TypeScript source; images install workspace devDependencies so
  `node --import tsx` matches [`apps/backend/package.json`](../apps/backend/package.json) `start` / `worker` scripts.
- **`web` build:** requires `API_INTERNAL_URL` at build time (`next.config.ts`
  guard). The example compose passes `http://api:3333` as build arg and runtime env.

## Verification (operator)

After deploy, without running local `docker build` in CI unless desired:

1. `web` serves the public domain over HTTPS (Dokploy Domain).
2. `GET /api/health` succeeds from inside the `api` container (Compose healthcheck).
3. Sign-in and reader flows work through the web origin (no direct public API URL).
4. Worker processes a ping job and TTS-related jobs when triggered.
