# Spikes

Isolated experiments that must not change default Node delivery (`pnpm dev`, `pnpm jobs`).

| Spike        | Purpose                                                                                                                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 (removed) | Greenfield vinext probe — see [`docs/research/cf-workers-p1-findings.md`](../docs/research/cf-workers-p1-findings.md)                                                                                                      |
| **P4-V1**    | Workers build path lives in **`client/`** (`vite.config.ts`, `cloudflare.config.ts`, `*:vinext` / `*:workers` scripts). See [`docs/research/cf-workers-p4-v1-findings.md`](../docs/research/cf-workers-p4-v1-findings.md). |

Do not add a second full app tree here unless a slice needs isolation from `client/` dependencies.
