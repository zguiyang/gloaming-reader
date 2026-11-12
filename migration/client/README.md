# `@gloaming/client`

Next.js app: **UI + `/api/*` Route Handlers** + BullMQ Jobs (`jobs/`, second process).

## Docs

- **[STRUCTURE.md](./STRUCTURE.md)** — directories, two-tier shared, dependency rules
- **Local run:** [`../LOCAL_RUN.md`](../LOCAL_RUN.md)
- Parent: [`../README.md`](../README.md)
- Stages: [`../../docs/cloudflare-fullstack-refactor-stages.md`](../../docs/cloudflare-fullstack-refactor-stages.md)

## Commands

From `migration/`:

```bash
pnpm --filter @gloaming/client dev
pnpm --filter @gloaming/client dev:worker
pnpm --filter @gloaming/client build
pnpm --filter @gloaming/client typecheck
pnpm --filter @gloaming/client db:migrate
```

## Layout (short)

| Path                    | Role                                                      |
| ----------------------- | --------------------------------------------------------- |
| `app/`                  | Pages + `app/api` thin transport                          |
| `features/`             | Product UI (parity with `apps/web`)                       |
| `components/`           | UI primitives + navigation chrome                         |
| `lib/`                  | Client/RSC glue (auth client, query, locale, api-request) |
| `shared/`               | In-app UI ↔ server contracts                              |
| `jobs/`                 | BullMQ entry + processors (second OS process)             |
| `server/`               | Domains, infra, application/commands, **inlined `db/`**   |
| `constants/`, `public/` | App constants and static assets                           |

## Package placement

| Module           | Where                                                                   | Note                                        |
| ---------------- | ----------------------------------------------------------------------- | ------------------------------------------- |
| DB               | `server/db/`                                                            | Inlined — only this app consumes it         |
| i18n             | `@gloaming/i18n` in `migration/packages/i18n`                           | Transitional                                |
| Shared contracts | `@gloaming/shared` + prefer `client/shared/` for new app-only contracts | Do not expand packages for single-app needs |

## Non-goals (this tree)

- Nested Hono as API host
- LangChain / Azure Speech **SDK** on the live path (legacy under `server/_legacy_hono` for reference only)
- Claiming Cloudflare Workers readiness (P4)
