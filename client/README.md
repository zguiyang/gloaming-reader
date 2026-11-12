# `@gloaming/client`

Next.js app: **UI + `/api/*` Route Handlers** + BullMQ Jobs (`jobs/`, second process).

## Docs

- **[STRUCTURE.md](./STRUCTURE.md)** — directories, two-tier shared, dependency rules
- **Local run:** [`../docs/LOCAL_RUN.md`](../docs/LOCAL_RUN.md)
- Parent: [`../README.md`](../README.md)
- Stages: [`../../docs/cloudflare-fullstack-refactor-stages.md`](../../docs/cloudflare-fullstack-refactor-stages.md)

## Commands

From repo root:

```bash
pnpm --filter @gloaming/client dev
pnpm --filter @gloaming/client dev:jobs
pnpm --filter @gloaming/client build
pnpm --filter @gloaming/client build:jobs
pnpm --filter @gloaming/client typecheck
pnpm --filter @gloaming/client db:migrate
```

## Layout (short)

| Path                    | Role                                                      |
| ----------------------- | --------------------------------------------------------- |
| `app/`                  | Pages + `app/api` thin transport                          |
| `features/`             | Product UI                                                |
| `components/`           | UI primitives + navigation chrome                         |
| `lib/`                  | Client/RSC glue (auth client, query, locale, api-request) |
| `shared/`               | UI ↔ server contracts (`@/shared/*`)                      |
| `i18n/`                 | Locale messages + `t()` (`@/i18n`)                        |
| `jobs/`                 | BullMQ entry + processors (second OS process)             |
| `server/`               | Domains, infra, application/commands, **inlined `db/`**   |
| `constants/`, `public/` | App constants and static assets                           |

## Contract placement

| Module           | Where                           | Note                                |
| ---------------- | ------------------------------- | ----------------------------------- |
| DB               | `server/db/`                    | Inlined — only this app consumes it |
| i18n             | `i18n/` via `@/i18n`            | Message JSON + `t()`                |
| Shared contracts | `shared/` via `@/shared/<area>` | Zod/types per domain subfolder      |

## Non-goals (this tree)

- Nested Hono as API host
- LangChain / Azure Speech **SDK** on the live path (legacy under `archive/` only)
- Claiming full Cloudflare Workers readiness (P4-V2 still open; P4-V1 is build/Preview only)
