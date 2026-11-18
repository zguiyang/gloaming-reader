# Deployment

> **Status:**
>
> | Path                                  | Role                                                                                                                    |
> | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
> | **Default open-source local product** | Repo-root single Next package (UI + `/api/*`) + optional `jobs/` worker. See [LOCAL_RUN.md](./LOCAL_RUN.md).            |
> | **Recommended production topology**   | Conventional Node host (VPS): **app** (Next, often behind Nginx) + **jobs**; Postgres / Redis / object storage managed. |
> | **Cloudflare (optional)**             | DNS, TLS, CDN (orange-cloud proxy) in front of the origin — **not** Workers as the app runtime.                         |

## Default product (repo root)

| Process | Entry                                         | Public           | Role                 |
| ------- | --------------------------------------------- | ---------------- | -------------------- |
| `web`   | Repo root — `pnpm build` / `next start`       | Yes, port `3000` | UI + Route Handlers  |
| `jobs`  | Same package — `pnpm jobs` (`jobs/worker.ts`) | No               | BullMQ ingest / jobs |

Environment template: [`.env.example`](../.env.example). PostgreSQL, Redis, and S3-compatible storage are external. Same-origin APIs — no `API_INTERNAL_URL` between web and API.

```bash
pnpm install
pnpm db:migrate
pnpm build
pnpm start          # web
pnpm jobs           # second process
```

Typical production containers: **1** Next (+ Nginx if desired) and **1** Jobs. Do not treat Cloudflare Workers / vinext as part of this topology. Do not restore three long-lived API services as the recommended open-source default.
