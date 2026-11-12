# Cloudflare Workers path

**Status:** P4-V1 evidence lane (not default open-source delivery).

Default local delivery remains **Next.js + optional Jobs process** at the repo root — see [`LOCAL_RUN.md`](./LOCAL_RUN.md).

## Scripts

| Script                        | Meaning                                                        |
| ----------------------------- | -------------------------------------------------------------- |
| `pnpm dev`                    | Next.js (unchanged)                                            |
| `pnpm jobs`                   | BullMQ worker (unchanged; **not** on Workers)                  |
| `pnpm check:workers`          | `vinext check` compatibility report                            |
| `pnpm build:workers`          | Vite/vinext production build for Workers                       |
| `pnpm dev:vinext`             | Vite dev on port **3001** (parallel to Next)                   |
| `pnpm start:vinext`           | Local preview of Workers build (`vite preview`)                |
| `pnpm deploy:workers-preview` | Non-production Preview via `vinext-cloudflare previews deploy` |

Requires `pnpm install` in the repo root; if vinext build fails on `workerd`, run `pnpm approve-builds` (or allow `workerd` build scripts) as prompted by pnpm 11.

## Config files

- `vite.config.ts` — `vinext()` + `@cloudflare/vite-plugin`
- `cloudflare.config.ts` — Worker name `gloaming-client-p4` (`cf` typed config)
- `postcss.config.mjs` — Tailwind for vinext (replaces turbopack CSS rules in Workers builds)

## Smoke routes (no DB)

- `GET /api/cf-smoke` — intentional P4 probe
- `GET /api/health/live` — existing liveness JSON

Do **not** treat Preview success on these paths as auth/DB/Free-CPU fitness; that is **P4-V2**.

## Deploy

Authenticated Cloudflare account required (`cf auth list` / `cf auth login`). Use **preview** only unless explicitly authorized for production traffic:

```bash
pnpm run build:workers
pnpm exec vinext-cloudflare previews deploy --preview-name <name>
```
