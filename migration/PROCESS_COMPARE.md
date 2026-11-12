# Process topology compare — old three vs new two

Local cutover target for `migration/client` (not Cloudflare).

| Concern               | Old (`apps/*`)                            | New (`migration/`)                                                              |
| --------------------- | ----------------------------------------- | ------------------------------------------------------------------------------- |
| UI                    | `apps/web` Next                           | `migration/client` Next                                                         |
| HTTP API              | `apps/backend` Hono                       | Same Next app — `app/api/**` Route Handlers                                     |
| Jobs                  | Backend worker entry / separate process   | Same package — run `pnpm jobs` (`tsx`); package gate `build:jobs` (`tsc`)       |
| Process count (local) | **3** (web + api + worker)                | **2** (Next + worker)                                                           |
| Auth                  | Better Auth on Hono; web may proxy `/api` | Better Auth via `toNextJsHandler` same-origin `/api/auth`                       |
| Shared DB schema      | `@gloaming/db` package                    | **Inlined** `client/server/db/`                                                 |
| Contracts             | `@gloaming/shared`                        | Transitional `migration/packages/shared` + prefer `client/shared/` for app-only |
| AI                    | LangChain path (legacy)                   | Vercel AI SDK on live path                                                      |
| TTS                   | Speech SDK (legacy)                       | Azure Speech REST                                                               |
| Data plane            | Postgres + Redis + S3                     | Same                                                                            |

## Intentionally unchanged this wave

- Old `apps/web` + `apps/backend` still exist for comparison (**N5** not authorized).
- Jobs remain BullMQ on Redis (local default); CF Queues undecided (**R5**).
- No claim that the dual-process tree runs on Workers (**P4**).

## Smoke gaps still expected

Some flows may fail without keys/data (LLM, Azure TTS, S3 upload). Track against [`LOCAL_RUN.md`](./LOCAL_RUN.md); do not treat partial smoke as N5/P4 go-ahead.
