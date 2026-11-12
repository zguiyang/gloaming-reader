# Jobs (same package, second process)

All Jobs code for the colocated BullMQ worker lives here at the **`client/`
package root** — entry and processors together. No separate workspace package.

| Item        | Path                                                        |
| ----------- | ----------------------------------------------------------- |
| Entry       | `jobs/worker.ts`                                            |
| Processors  | `jobs/*.ts` (same directory)                                |
| Queue infra | `server/infra/queue`                                        |
| Run         | `pnpm --filter @gloaming/client jobs` (`node --import tsx`) |
| Watch       | `pnpm --filter @gloaming/client dev:jobs`                   |
| Typecheck   | `pnpm --filter @gloaming/client build:jobs`                 |

Domain / API code enqueues via `@/jobs/...` job names and `server/infra/queue`.
Not the Cloudflare Free default; CF Queues remain open (R5).
