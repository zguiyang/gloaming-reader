# T3 — Workers-hostile dependency inventory (`migration/client`)

**Status:** Working inventory (not a Workers readiness claim).  
**Scope:** What the local full-stack tree uses today vs what P4 must revisit.

| Dependency / pattern                 | Where                                            | Local open-source                         | Workers (P4)                                                                                                       |
| ------------------------------------ | ------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **BullMQ + Redis queues**            | `jobs/worker.ts`, `server/infra/queue`           | **Keep** as second OS process             | Must replace or isolate (Queues / external worker / paid long tasks). Do **not** pretend Free Workers runs BullMQ. |
| **`pg` / Drizzle**                   | `server/infra/db`, `server/db`                   | Keep (Node)                               | Needs Workers-compatible Postgres driver / Hyperdrive / external fetch DB — decide in P4.                          |
| **`ioredis`**                        | cache, queue, auth secondary storage, rate limit | Keep                                      | Edge Redis client or HTTP Redis; session secondary storage redesign.                                               |
| **`sharp`**                          | ingest / image optimize                          | Keep for Node worker/API                  | Native binary — isolate to Jobs or replace.                                                                        |
| **`yauzl` / EPUB parse**             | ingest parser                                    | Keep on Node                              | Heavy CPU + filesystem — Jobs lane or paid CPU; open item in guidance.                                             |
| **`cheerio` / HTML**                 | ingest, content                                  | Keep                                      | Bundle size / Node APIs — audit in P4 build.                                                                       |
| **Azure Speech REST (`fetch`)**      | `server/infra/tts`                               | Keep (T2 done)                            | Compatible in principle; secrets stay server-side.                                                                 |
| **Vercel AI SDK + `@ai-sdk/openai`** | `domains/ai/runtime`                             | Keep (T1 done)                            | Compatible in principle; outbound fetch + secrets.                                                                 |
| **Better Auth + Drizzle adapter**    | `server/infra/auth`                              | Keep                                      | Cookie/session + Node crypto paths need P4 verification.                                                           |
| **`rate-limiter-flexible`**          | Next HTTP rate limit helper                      | Keep with Redis                           | Same Redis story as above.                                                                                         |
| **Vendored `iconv-lite`**            | `migration/vendor`                               | Install workaround (Cursor `.idea` block) | Irrelevant to runtime shape.                                                                                       |
| **Hono / LangChain / Speech SDK**    | `_legacy_hono/` only                             | Not mounted                               | Must stay out of live graph.                                                                                       |

## Explicit non-claims

- Local dual-process green ≠ Free CPU / Workers fitness.
- R5 (Jobs/Queues strategy) remains an open product/platform decision.
- This file is input to **P4-V1/V2**, not permission to start N5 deletions.
