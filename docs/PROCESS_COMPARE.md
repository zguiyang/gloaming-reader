# Process topology compare — old three vs new two

Local cutover target for the repo-root Next app (not Cloudflare).

| Concern               | Old (`archive/apps/*`)                    | New (repo root product)                                                   |
| --------------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| UI                    | `archive/apps/web` Next                   | Repo-root Next                                                            |
| HTTP API              | `archive/apps/backend` Hono               | Same Next app — `app/api/**` Route Handlers                               |
| Jobs                  | Backend worker entry / separate process   | Same package — run `pnpm jobs` (`tsx`); package gate `build:jobs` (`tsc`) |
| Process count (local) | **3** (web + api + worker)                | **2** (Next + worker)                                                     |
| Auth                  | Better Auth on Hono; web may proxy `/api` | Better Auth via `toNextJsHandler` same-origin `/api/auth`                 |
| Shared DB schema      | `@gloaming/db` package                    | **Inlined** `server/db/`                                                  |
| Contracts             | `@gloaming/shared` (archived)             | `shared/` (`@/shared/*`) in the Next app                                  |
| AI                    | LangChain path (legacy)                   | Vercel AI SDK on live path                                                |
| TTS                   | Speech SDK (legacy)                       | Azure Speech REST                                                         |
| Data plane            | Postgres + Redis + S3                     | Same                                                                      |

## Intentionally unchanged this wave

- Legacy `archive/apps/*` + `archive/packages/*` kept for comparison (**N5 demote**; not the default path).
- Live install is a **single package** at the repo root (`shared/` + `i18n/` colocated; no product workspace packages).
- Jobs remain BullMQ on Redis (local default); CF Queues undecided (**R5**).
- No claim that the dual-process tree runs on Workers (**P4**).

## Smoke gaps still expected

Some flows may fail without keys/data (LLM, Azure TTS, S3 upload). Track against [`LOCAL_RUN.md`](./LOCAL_RUN.md); do not treat partial smoke as N5/P4 go-ahead.
