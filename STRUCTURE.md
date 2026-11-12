# Repository structure (live product)

Single-package Next app at the **repository root** (UI + all HTTP APIs + optional same-package Jobs).  
Stages: [`docs/cloudflare-fullstack-refactor-stages.md`](docs/cloudflare-fullstack-refactor-stages.md).  
Direction locks: L8 — deploy merge does **not** collapse server domains into UI modules.

## Tree

```text
.
  app/                    # App Router: pages, layouts, Route Handlers
    (app)/ (auth)/ (reader)/ admin/
    api/                  # thin HTTP transport → server/domains
  features/               # product UI
  components/             # design-system + shell widgets
  lib/                    # browser / RSC runtime glue only
  shared/                 # ★ UI ↔ server contracts
  i18n/                   # ★ locale messages + t()
  jobs/                   # ★ BullMQ Jobs face (second OS process)
  server/                 # server-only modules
    db/                   # ★ Drizzle schema + migrations
    domains/
    infra/
    application/
  constants/
  public/
  docs/                   # product + ops docs
  archive/                # legacy three-app / packages (comparison only)
  rules/                  # agent/project rules
```

## Contracts and i18n

| Location      | Import alias | Consumers                                          | Put here                                                       |
| ------------- | ------------ | -------------------------------------------------- | -------------------------------------------------------------- |
| **`shared/`** | `@/shared/…` | `features/*`, `app/api`, `server/domains`, `jobs/` | DTOs, Zod, error codes, API path constants, pure types/helpers |
| **`i18n/`**   | `@/i18n`     | UI + server                                        | Message JSON, locale helpers                                   |
| **`lib/`**    | `@/lib/…`    | Browser / RSC glue                                 | Auth client, fetch, React Query, locale context, utils         |

Do not put React, Route Handler types, DB access, or secrets in `shared/` or `i18n/`.

## Dependency direction

```text
features  ──►  shared, i18n, lib, components, constants
app/api   ──►  server (+ shared, i18n)
server    ──►  shared, i18n, server/infra, server/db
shared    ──✘──  features | server | components | i18n UI glue
lib       ──✘──  server/domains
```

- `app/**/page.tsx` and layouts compose `features/` (thin routes).
- `app/api/**/route.ts` validates → calls `server/domains` → responds.
- Domain logic must not import HTTP framework types. **No nested Hono.**

## Package layout

This repo is a **single pnpm package** (`package.json` at root). There is **no**
multi-package workspace (`packages:` list).

pnpm 11 stores dependency build approvals in `pnpm-workspace.yaml` (`allowBuilds`
for `sharp` / `esbuild` / `workerd` / …). That file is **not** a monorepo
manifest here—deleting it makes `pnpm install` recreate placeholders.

## Explicit non-goals

- Nested Hono as the end-state API host
- Treating BullMQ worker as Cloudflare-ready
- Claiming Free CPU / Workers fitness (P4-V2 still open)
