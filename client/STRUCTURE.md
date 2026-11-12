# `@gloaming/client` directory structure

Target layout for the Next app under `client/` (UI + all HTTP APIs + same-package Jobs).  
Parent stages: [`docs/cloudflare-fullstack-refactor-stages.md`](../../docs/cloudflare-fullstack-refactor-stages.md).  
Direction locks: L8 — deploy merge does **not** collapse server domains into UI modules.

## Tree

```text
client/
  app/                    # App Router: pages, layouts, Route Handlers
    (app)/ (auth)/ (reader)/ admin/
    api/                  # thin HTTP transport → server/domains
  features/               # product UI
  components/             # design-system + shell widgets
  lib/                    # client / RSC runtime glue only
  shared/                 # ★ UI ↔ server contracts (former packages/shared)
  i18n/                   # ★ locale messages + t() (former packages/i18n)
  jobs/                   # ★ BullMQ Jobs face (entry + processors; second OS process)
  server/                 # server-only modules
    db/                   # ★ inlined Drizzle schema + migrations (not packages/db)
    domains/
    infra/                # includes queue adapter used by Jobs
    application/          # commands (not job processors)
  constants/
  public/
```

## Contracts and i18n

| Location             | Import alias | Consumers                                          | Put here                                                       |
| -------------------- | ------------ | -------------------------------------------------- | -------------------------------------------------------------- |
| **`client/shared/`** | `@/shared/…` | `features/*`, `app/api`, `server/domains`, `jobs/` | DTOs, Zod, error codes, API path constants, pure types/helpers |
| **`client/i18n/`**   | `@/i18n`     | UI + server (messages, `t()`, locale resolution)   | Message JSON, locale helpers                                   |
| **`client/lib/`**    | `@/lib/…`    | Browser / RSC glue                                 | Auth client, fetch, React Query, locale context, utils         |

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

## Phase mapping

| Slice      | Status                                                                  |
| ---------- | ----------------------------------------------------------------------- |
| **N0–N1**  | Done — scaffold                                                         |
| **N2**     | Done — shell / styles / route groups                                    |
| **N3**     | Done — features + pages                                                 |
| **N4**     | Done — Route Handlers + server + `jobs/`; T1/T2 on path                 |
| **N5**     | Done — legacy apps/packages under `archive/`; tree promoted to root     |
| **Inline** | Done — `shared/` + `i18n/` colocated in `client/` (no root `packages/`) |
| **P4-V1**  | Done — vinext Workers build + thin Preview                              |
| **P4-V2**  | Not started — auth/DB/Free CPU fitness                                  |

## Explicit non-goals

- Nesting Hono as the end-state API host
- Treating BullMQ worker as Cloudflare-ready
- Claiming Free CPU / Workers fitness (P4)
