# Deployment

> **Status (2026-11 N5 demote):**
>
> | Path                                  | Role                                                                                                                                                                                       |
> | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
> | **Default open-source local product** | `client/` — one Next app (UI + `/api/*`) + optional `jobs/` worker. See [LOCAL_RUN.md](./LOCAL_RUN.md).                                                                                    |
> | **Archived legacy production layout** | `archive/apps/*` — former `web` + `api` + `worker` three-service Docker topology (below). Comparison / rollback reference only.                                                            |
> | **Target delivery shape (not done)**  | One deployable Next app on managed data plane; Cloudflare Workers — see [cloudflare fullstack refactor guidance](./cloudflare-fullstack-refactor-guidance.md). **P4 Workers not started.** |
>
> Do not read this file as claiming Cloudflare Workers migration (P4) is complete.

## Default product (`client/`)

Operator outline (details: [LOCAL_RUN.md](./LOCAL_RUN.md)):

| Process | Entry                                                              | Public           | Role                              |
| ------- | ------------------------------------------------------------------ | ---------------- | --------------------------------- |
| `web`   | `client/` — `pnpm build` / `next start` (or platform Next adapter) | Yes, port `3000` | UI + Route Handlers               |
| `jobs`  | Same package — `pnpm jobs` (`jobs/worker.ts`)                      | No               | BullMQ ingest, discovery, cleanup |

Environment template: [`client/.env.example`](../client/.env.example). PostgreSQL, Redis, and S3-compatible storage are external. Same-origin APIs — no `API_INTERNAL_URL` between web and API.

Database migrations (repo root):

```bash
pnpm install
pnpm db:migrate
```

---

## Archived: three-service layout (`archive/apps/*`)

The following described the **former** default production topology before N5 demote. Paths now live under `archive/`.

Gloaming can run on a VPS or a PaaS that supports Docker services or supervised Node processes. That legacy application had three independent services:

| Service  | Image / entrypoint                                | Public access    | Role                               |
| -------- | ------------------------------------------------- | ---------------- | ---------------------------------- |
| `web`    | `archive/apps/web/Dockerfile`                     | Yes, port `3000` | Next.js app and `/api/*` proxy     |
| `api`    | `archive/apps/backend/Dockerfile` + `pnpm start`  | No, port `3333`  | Hono API, auth, and job enqueueing |
| `worker` | `archive/apps/backend/Dockerfile` + `pnpm worker` | No               | BullMQ jobs, ingest, and cleanup   |

PostgreSQL, Redis, and S3-compatible object storage are external dependencies. Resend is used for transactional email and Azure Speech is used for TTS.

## Deploy the services

1. Connect the repository to the platform and use the repository root as the build context. The Dockerfiles depend on the pnpm workspace and root `tsconfig.base.json`.
2. Create one `web`, one `api`, and one `worker` service. The `api` and `worker` use the same image. Prefer keeping the image `CMD` and selecting the entrypoint with `GLOAMING_SERVICE` (`api` by default; set `GLOAMING_SERVICE=worker` on the worker service). You can also override the command explicitly:

   ```bash
   pnpm start
   pnpm worker
   ```

   Both paths load server code through the `tsx` loader (`node --import tsx`), resolving `@/` path aliases to TypeScript sources under `client/` (including `shared/` and `i18n/`).

3. Configure private service networking. Set `API_INTERNAL_URL` for `web` to the private `api` address, normally `http://api:3333`. Expose a public domain only for `web`.
4. Keep `api` and `worker` running with automatic restart. A stopped worker leaves queued jobs pending.

The web image requires `API_INTERNAL_URL` during the build as well as at runtime. Set it as a build argument or platform build variable.

Discover Save materialization and EPUB parsing use the separate `gloaming-discovery-import` queue. The normal `pnpm worker` mode consumes it alongside the legacy `gloaming` queue so new API jobs always have a consumer; `pnpm --filter @gloaming/backend worker:discovery-import` runs an import-only consumer. If both modes run, they share that queue and add combined capacity; the import-only process creates no other queue consumers or AI dispatchers. During rollout, do not move waiting or active jobs between queues: legacy jobs drain on `gloaming`, while new jobs go to the import queue. BullMQ de-duplicates only within a queue, so overlapping old/new jobs can occur during deployment; SourceRecord row locking and parse workflow claims keep materialization and parsing idempotent. Deploy a consumer-capable worker with the producers, then wait for legacy Discover jobs to drain before considering any later removal of their compatibility handlers.

## Environment variables

Use [`archive/apps/web/.env.example`](../archive/apps/web/.env.example), [`archive/apps/backend/.env.example`](../archive/apps/backend/.env.example), and [`archive/apps/backend/.env.worker.example`](../archive/apps/backend/.env.worker.example) as the source of variable names. Inject values through the platform secret manager; never commit them.

`web`:

- `API_INTERNAL_URL` — private API origin; required.
- `NEXT_PUBLIC_APP_URL` — public HTTPS origin; optional when same-origin behavior is sufficient.

`api`:

- `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=3333`.
- `FRONTEND_URL` — public web origin.
- `DATABASE_URL`, `REDIS_URL`.
- `BETTER_AUTH_SECRET`.
- `RESEND_API_KEY`, `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME`.
- `LLM_CONFIG_ENCRYPTION_KEY`.
- `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, and optional `S3_ENDPOINT`.
- Optional GitHub OAuth pair: `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

`worker`:

- `NODE_ENV=production`, `GLOAMING_SERVICE=worker`, and optional `LOG_LEVEL`.
- The same `DATABASE_URL`, `REDIS_URL`, `LLM_CONFIG_ENCRYPTION_KEY`, and `S3_*` values as `api`.
- It does not need frontend, auth, mail, or GitHub OAuth variables.

The API and worker validate their configuration at startup and exit on missing or invalid required values. The worker image retains workspace devDependencies because the runtime command loads `tsx` (`node --import tsx dist/worker.js`).

If the platform runs Node directly instead of building Docker images, install the full workspace, run `pnpm build`, and supervise these three commands:

```bash
pnpm --filter @gloaming/backend start
pnpm --filter @gloaming/backend worker
pnpm --filter @gloaming/web start
```

In this mode, set `API_INTERNAL_URL` to the private API address reachable by the web process.

## First deployment

Run these steps from a trusted operator environment or the platform's one-off task facility:

1. Provision PostgreSQL, Redis, and the S3-compatible bucket. Confirm that the application services can reach them.
2. Back up PostgreSQL, then run the migration once with the production `DATABASE_URL`:

   ```bash
   pnpm install
   pnpm db:migrate
   ```

   Do not run migrations from normal service startup and do not run `seed:dev` in production.

3. Deploy `api`, `worker`, and `web`.
4. Before opening registration, create the first administrator with `ADMIN_EMAIL` and `ADMIN_PASSWORD` injected only into the one-off task:

   ```bash
   pnpm --filter @gloaming/backend create:admin
   ```

   The command refuses to run when an administrator already exists. Do not put these values in the repository, service configuration, or shell history.

5. Verify the deployment, then open registration:

   - `GET /api/health/live` returns `200`.
   - `GET /api/health/ready` returns `200` and Postgres/Redis are reachable.
   - Sign-in and reader flows work through the public web origin.
   - An authenticated admin ping job is enqueued and processed by `worker`.
   - A real email and object-storage upload/read succeed.
   - A publish smoke test passes; reader audio is synthesized lazily per segment on first listen (there is no publish-time audio generation).

Registration should remain closed or restricted until these checks pass.

## Updates and rollback

Build and deploy all three application services from the same revision. Roll back by redeploying the previous application image versions. Database migrations are not automatically reversible, so review schema changes separately before a rollback.
