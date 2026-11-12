# P4-V1 findings: repo-root Next app on Cloudflare Workers (vinext)

**Date:** 2026-11-12  
**Status:** P4-V1 in progress — build + thin Preview evidence; **not** P4-V2  
**Branch:** `dev`  
**Adapter:** vinext 1.4.5 + `@cloudflare/vite-plugin` v2 beta + `cf` CLI (per P1 preference)

## Summary

The live product tree at the **repo root** can be **built with vinext** and deployed to a **non-production Worker Preview** without changing default Node scripts (`pnpm dev`, `pnpm jobs`). Marketing home and a **thin API smoke path** respond on Preview; **DB-backed readiness fails** at runtime (expected for P4-V1).

**What this proves:** Workers-oriented tooling is wired in-repo; full app **bundle** compiles; static/marketing SSR + minimal route handlers can run on Workers Preview.

**What this does not prove (P4-V2 / open items):** Better Auth + session, Postgres (`pg`/Drizzle), Redis (`ioredis`), BullMQ Jobs, `sharp`/ingest CPU, Free-plan **10 ms** CPU on assist/TTS/auth paths, or production cutover.

## Commands run

| Command                                                         | Result                                                                                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `vinext check` (before init)                                    | **Pass** — 90% compatible; 1 `__dirname` naming issue                                                                            |
| `vinext init --platform=cloudflare …`                           | **Pass** — generated `vite.config.ts`, `cloudflare.config.ts`, `*:vinext` scripts; **did not** replace `pnpm dev` / `pnpm build` |
| `pnpm run build:workers` (`vite build`)                         | **Pass** — 92 route handlers listed (incl. new `/api/cf-smoke`)                                                                  |
| `pnpm run start:vinext` + `curl localhost:4173/api/health/live` | **Pass** — `{"status":"live"}`; `/` **200**                                                                                      |
| `vinext check` (after `__dirname` fix)                          | **Pass** — **95%**, 0 issues                                                                                                     |
| `pnpm run typecheck` (root)                                     | **Fail** — pre-existing Cheerio/DOM typing errors in `features/reader/audio/` (unchanged by P4-V1)                               |
| `vinext-cloudflare previews deploy --preview-name p4-v1-smoke`  | **Pass** (twice; v2 includes `/api/cf-smoke`)                                                                                    |
| Shell `curl` → `*.workers.dev`                                  | **Fail** — TCP timeout (same network caveat as P1)                                                                               |

## Preview deployment

| Item             | Value                                                                              |
| ---------------- | ---------------------------------------------------------------------------------- |
| Worker name      | `gloaming-client-p4`                                                               |
| Preview name     | `p4-v1-smoke`                                                                      |
| URL              | `https://p4-v1-smoke-gloaming-client-p4.zhaoguiyang18.workers.dev`                 |
| Deploy mechanism | `vinext-cloudflare previews deploy` (Preview Build Output, not production traffic) |

### Browser checks (IDE browser; CLI curl timed out)

| Path                    | Result                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `GET /`                 | **200** — Gloaming marketing home (`Gloaming · 安静的真实阅读环境`)                           |
| `GET /api/cf-smoke`     | **200** — JSON smoke (`runtime: vinext-worker`) after second Preview deploy                   |
| `GET /api/health/live`  | Served (JSON; a11y tree empty — not an error page)                                            |
| `GET /api/health/ready` | **Worker exception** — Cloudflare **1101** (touches DB readiness; no bindings/env on Preview) |

**Not observed:** Error **1102** on `/`, `/api/cf-smoke`, or marketing SSR in browser. **No** Free CPU timing measurement was performed.

## Repo changes (durable Workers path)

| Area                                                                                | Change                                                                                                                                                               |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/vite.config.ts`, `client/cloudflare.config.ts`, `client/postcss.config.mjs` | vinext + Cloudflare plugin + Tailwind PostCSS for Workers builds                                                                                                     |
| `client/package.json`                                                               | `"type": "module"`; vinext deps; `check:workers`, `build:workers`, `deploy:workers-preview`, `dev:vinext`, `build:vinext`, …; **unchanged** `dev` / `build` / `jobs` |
| Root `package.json`                                                                 | `check:workers`, `build:workers` forwarders                                                                                                                          |
| `client/app/api/cf-smoke/route.ts`                                                  | Thin smoke route (no DB)                                                                                                                                             |
| `client/server/domains/ai/prompts/service.ts`                                       | Rename `__dirname` → `moduleDir` (vinext check)                                                                                                                      |
| [`docs/CLOUDFLARE-WORKERS.md`](../CLOUDFLARE-WORKERS.md)                            | Operator notes (moved from `client/docs/`)                                                                                                                           |

## Blockers for full product on Workers (inputs for P4-V2)

From build graph + Preview behaviour + [`T3-DEPENDENCY-INVENTORY.md`](../T3-DEPENDENCY-INVENTORY.md):

| Blocker                                 | Notes                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Postgres `pg` + Drizzle**             | Bundles in vinext build; Preview has **no** Hyperdrive/D1 substitute wired — `/api/health/ready` throws            |
| **Redis `ioredis`**                     | Sessions, cache, rate limits, queue enqueue — needs edge-safe client or external HTTP                              |
| **BullMQ / `jobs/`**                    | Second Node process; **not** Workers Free topology (R5 open)                                                       |
| **`sharp`, EPUB/`yauzl`, heavy ingest** | Native/heavy CPU; isolate to Jobs or paid CPU                                                                      |
| **Better Auth**                         | vinext library check passes; **unverified** on Workers with real cookies/DB                                        |
| **Secrets / bindings**                  | No production bindings in `cloudflare.config.ts` yet (assets only)                                                 |
| **Images**                              | `next/image` unoptimized on Workers until Images binding configured                                                |
| **Route classification**                | vinext warns many API routes are `?` unknown (dynamic `headers()`/`cookies()`) — ISR/cache behaviour not validated |

## pnpm / toolchain notes

- Install vinext with **pnpm** from repo root; allow **`workerd`** build scripts (`pnpm approve-builds`) if rolldown/workerd fails.
- **`npx vinext build`** without local install failed on rolldown bindings in sandbox — use workspace install.
- Monorepo: vinext init ran inside `client/`; contracts/i18n live as `client/shared/` and `client/i18n/` (`@/…` aliases).

## Next steps (P4-V2)

1. Define minimal **bindings matrix** (Hyperdrive or remote DB, Redis story, secrets) for non-smoke routes — still non-prod.
2. Measure **Free CPU** on `/api/assist/ask`, auth, and TTS after bindings exist — browser or unconstrained egress; do not infer from Preview home SSR alone.
3. Decide **Jobs/Queues** (R5) before claiming ingest/TTS background work on Workers.
4. Optional: Cloudflare Images + `imagesOptimizer()` if `next/image` optimization is required at the edge.
5. Keep **default OSS path** on Node until P4-V2 gates pass.

## Non-claims

- **Free CPU fitness** — not measured.
- **Full login / session / DB** — not validated; `/api/health/ready` fails on Preview.
- **Jobs on Workers** — BullMQ remains local second process only.
- **Production deployment** — only named **Preview** URLs above; no custom domain cutover.

## Related

- P1: [`cf-workers-p1-findings.md`](./cf-workers-p1-findings.md)
- Stages: [`../cloudflare-fullstack-refactor-stages.md`](../cloudflare-fullstack-refactor-stages.md) §6
- Operator doc: [`../CLOUDFLARE-WORKERS.md`](../CLOUDFLARE-WORKERS.md)
