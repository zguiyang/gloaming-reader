# Deployment

Gloaming can run on a VPS or a PaaS that supports Docker services or supervised Node processes. The production application has three independent services:

| Service  | Image / entrypoint                        | Public access    | Role                                  |
| -------- | ----------------------------------------- | ---------------- | ------------------------------------- |
| `web`    | `apps/web/Dockerfile`                     | Yes, port `3000` | Next.js app and `/api/*` proxy        |
| `api`    | `apps/backend/Dockerfile` + `pnpm start`  | No, port `3333`  | Hono API, auth, and job enqueueing    |
| `worker` | `apps/backend/Dockerfile` + `pnpm worker` | No               | BullMQ jobs, TTS, ingest, and cleanup |

PostgreSQL, Redis, and S3-compatible object storage are external dependencies. Resend is used for transactional email and Azure Speech is used for TTS.

## Deploy the services

1. Connect the repository to the platform and use the repository root as the build context. The Dockerfiles depend on the pnpm workspace and root `tsconfig.base.json`.
2. Create one `web`, one `api`, and one `worker` service. The `api` and `worker` use the same image with different commands:

   ```bash
   pnpm start
   pnpm worker
   ```

3. Configure private service networking. Set `API_INTERNAL_URL` for `web` to the private `api` address, normally `http://api:3333`. Expose a public domain only for `web`.
4. Keep `api` and `worker` running with automatic restart. A stopped worker leaves queued jobs pending.

The web image requires `API_INTERNAL_URL` during the build as well as at runtime. Set it as a build argument or platform build variable.

## Environment variables

Use [`apps/web/.env.example`](../apps/web/.env.example), [`apps/backend/.env.example`](../apps/backend/.env.example), and [`apps/backend/.env.worker.example`](../apps/backend/.env.worker.example) as the source of variable names. Inject values through the platform secret manager; never commit them.

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

- `NODE_ENV=production` and optional `LOG_LEVEL`.
- The same `DATABASE_URL`, `REDIS_URL`, `LLM_CONFIG_ENCRYPTION_KEY`, and `S3_*` values as `api`.
- It does not need frontend, auth, mail, or GitHub OAuth variables.

The API and worker validate their configuration at startup and exit on missing or invalid required values. The worker image retains workspace devDependencies because the current runtime command loads `tsx`.

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
   - A real email, object-storage upload/read, and TTS job succeed.
   - A publish smoke test passes with ready default-US audio for synthesizable parts.

Registration should remain closed or restricted until these checks pass.

## Updates and rollback

Build and deploy all three application services from the same revision. Roll back by redeploying the previous application image versions. Database migrations are not automatically reversible, so review schema changes separately before a rollback.
