# T3 — Runtime dependency inventory (live Next app)

**Status:** Working inventory for the Node dual-process product (Next + `jobs/`).  
**Scope:** What the local full-stack tree uses today on a conventional Node host.

| Dependency / pattern                 | Where                                            | Role                                  |
| ------------------------------------ | ------------------------------------------------ | ------------------------------------- |
| **BullMQ + Redis queues**            | `jobs/worker.ts`, `server/infra/queue`           | Second OS process / container         |
| **`pg` / Drizzle**                   | `server/infra/db`, `server/db`                   | Postgres via Node `pg`                |
| **`ioredis`**                        | cache, queue, auth secondary storage, rate limit | Redis TCP client                      |
| **`sharp`**                          | ingest / image optimize                          | Native image pipeline (Jobs / server) |
| **`yauzl` / EPUB parse**             | ingest parser                                    | Heavy CPU + filesystem — Jobs lane    |
| **`cheerio` / HTML**                 | ingest, content                                  | HTML parse                            |
| **Azure Speech REST (`fetch`)**      | `server/infra/tts`                               | TTS; secrets stay server-side         |
| **Vercel AI SDK + `@ai-sdk/openai`** | `domains/ai/runtime`                             | Assist / LLM                          |
| **Better Auth + Drizzle adapter**    | `server/infra/auth`                              | Cookie/session + Drizzle              |
| **`rate-limiter-flexible`**          | Next HTTP rate limit helper                      | With Redis                            |
| **`iconv-lite`**                     | npm dep (cheerio / encoding)                     | Encoding                              |
| **Hono / LangChain / Speech SDK**    | `archive/apps/backend` only                      | Must stay out of the live app graph   |

## Explicit non-claims

- This inventory is for the **Node** app + Jobs topology, not Workers runtime fitness.
- Cloudflare may front the host for DNS/CDN only; it is not the app runtime.
