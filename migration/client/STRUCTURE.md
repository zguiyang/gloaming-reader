# `@gloaming/client` directory structure

Target layout for the Next app under `migration/client` (UI + all HTTP APIs + same-package worker).  
Parent stages: [`docs/cloudflare-fullstack-refactor-stages.md`](../../docs/cloudflare-fullstack-refactor-stages.md).  
Direction locks: L8 — deploy merge does **not** collapse server domains into UI modules.

## Tree

```text
migration/client/
  app/                    # App Router: pages, layouts, Route Handlers
    (app)/ (auth)/ (reader)/ admin/
    api/                  # thin HTTP transport → server/domains
  features/               # product UI
  components/             # design-system + shell widgets
  lib/                    # client / RSC runtime glue only
  shared/                 # ★ in-app UI ↔ server contracts
  server/                 # server-only modules
    db/                   # ★ inlined Drizzle schema + migrations (not packages/db)
    domains/
    infra/
    application/          # jobs + commands
    worker.ts             # BullMQ entry (second OS process)
    _legacy_hono/         # quarantined Hono/LangChain reference — not mounted
  constants/
  public/
```

## Two tiers of “shared”

| Location                   | Consumers                                           | Put here                                                       | Do not put                                  |
| -------------------------- | --------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------- |
| **`client/shared/`**       | Same app: `features/*`, `app/api`, `server/domains` | DTOs, Zod, error codes, API path constants, pure types/helpers | React, Next Request types, DB, secrets      |
| **`migration/packages/*`** | Cross-package or costly transitional (e.g. i18n)    | Authoritative contracts/i18n when package boundary is needed   | UI, Route Handlers, infra, **db** (inlined) |
| **`client/lib/`**          | Browser / RSC glue                                  | Auth client, fetch, React Query, locale, utils                 | Contract SSOT, server domains               |

Promote to `migration/packages/*` only when a second consumer appears. Do not keep permanent `file:` deps pointing at monorepo root `packages/*`.

## Dependency direction

```text
features  ──►  shared, lib, components, constants
app/api   ──►  server (+ shared)
server    ──►  shared, server/infra, server/db, @gloaming/* packages
shared    ──✘──  features | server | components
lib       ──✘──  server/domains
```

- `app/**/page.tsx` and layouts compose `features/` (thin routes).
- `app/api/**/route.ts` validates → calls `server/domains` → responds.
- Domain logic must not import HTTP framework types. **No nested Hono.**

## Phase mapping

| Slice     | Status                                                         |
| --------- | -------------------------------------------------------------- |
| **N0–N1** | Done — scaffold                                                |
| **N2**    | Done — shell / styles / route groups                           |
| **N3**    | Done locally — features + pages vs `apps/web`                  |
| **N4**    | Done locally — Route Handlers + server + worker; T1/T2 on path |
| **N5**    | Not authorized — slim/delete old apps                          |
| **P4**    | Not started — Workers                                          |

## Explicit non-goals

- Nesting Hono as the end-state API host
- Treating BullMQ worker as Cloudflare-ready
- Claiming Free CPU / Workers fitness (P4)
