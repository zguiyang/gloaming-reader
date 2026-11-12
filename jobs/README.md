# Jobs (BullMQ worker)

All Jobs code for the colocated BullMQ worker lives here at the repo root.

| Action    | Command                           |
| --------- | --------------------------------- |
| Run       | `pnpm jobs` (`node --import tsx`) |
| Watch     | `pnpm dev:jobs`                   |
| Typecheck | `pnpm build:jobs`                 |

Default local delivery is Next + this second OS process. Cloudflare Workers /
Queues readiness is a separate P4/R5 decision — do not treat this folder as
edge-ready.
