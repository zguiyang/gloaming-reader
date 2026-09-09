# Deploy targets (deferred)

**When:** after learning-loop / business features are done. Do not start this work while building product.

**Goal:** one Hono app (`apps/backend` `app.fetch`) deploys to **Cloudflare Workers** and to **Node** (VPS / Docker). Not two backends.

Today the Node adapter already exists (`src/index.ts` + `@hono/node-server`). Workers is a second entry later. Local/VPS stay Docker Postgres + Redis + Node.

**Current online path:** VPS Node — Compose for Postgres/Redis, HTTP API + a BullMQ worker process (two supervised Node processes). Cloudflare dual-entry remains deferred. Runbook and go-live verification order (build → migrate → confirm empty user table → start API → start Worker → first registration becomes admin → jobs/ping → mail/R2/Redis/core path verification → open registration): [`docs/vps-run.md`](./vps-run.md).

API and Worker import `env`, which runs Zod validation at module
load. Missing or invalid config exits the process immediately.

## Locked

| Decision                    | Choice                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| HTTP                        | Hono official multi-runtime: Workers `export default app`; Node keep `@hono/node-server`. No custom compatibility framework. |
| Database                    | Stay **PostgreSQL** + Drizzle. Workers uses **Hyperdrive** (still a Postgres URL). Do not migrate to D1.                     |
| Object storage              | Keep **S3-compatible R2** (current adapter). Do not switch to Workers-only R2 bindings.                                      |
| Cache                       | Redis protocol. Node: `ioredis`. Workers: HTTP Redis (e.g. Upstash) behind the same get/set.                                 |
| Auth                        | Better Auth + Hono handler as now; Workers needs `nodejs_compat` (`AsyncLocalStorage`).                                      |
| TTS (when touching Workers) | Azure **HTTP REST**, not `microsoft-cognitiveservices-speech-sdk`.                                                           |
| Prompts                     | Bundle templates into the build; do not `readFileSync` at runtime.                                                           |
| Workers plan                | Paid is expected (Free CPU 10ms/request is too tight for this API).                                                          |

Do **not** take Cloudflare-only primitives (D1, Durable Objects, R2 binding, KV as the cache SoT) if Node/VPS must keep working.

## Official refs (do not reinvent)

- [Hono on Cloudflare Workers](https://hono.dev/docs/getting-started/cloudflare-workers) / [Hono on Node](https://hono.dev/docs/getting-started/nodejs)
- [Cloudflare Hono guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/hono/) (GA)
- [Hyperdrive + Postgres](https://developers.cloudflare.com/hyperdrive/)
- [Better Auth + Hono](https://www.better-auth.com/docs/integrations/hono) (Workers: `nodejs_compat`)

## First slice (when this work starts)

1. Add a Workers entry; **do not remove** the Node entry.
2. Map env/secrets into the existing Zod config shape; Hyperdrive only on the Workers path.
3. Swap the Node-only drivers listed above; leave `modules/` alone.
