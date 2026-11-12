# P1 findings: Cloudflare Workers + vinext smoke

**Date:** 2026-11-12  
**Status:** P1 passed (with network caveat)  
**Branch/worktree used:** `spike/cf-workers-p1` @ `.worktrees/cf-workers-p1` (disposable)  
**Parent direction:** [`../cloudflare-fullstack-refactor-guidance.md`](../cloudflare-fullstack-refactor-guidance.md), [`../cloudflare-fullstack-refactor-stages.md`](../cloudflare-fullstack-refactor-stages.md)

## Summary

A **minimal new** vinext App Router probe (not `apps/web`) **built locally**, **deployed as a Worker Preview** on the authorized Cloudflare account, and **served** `/`, `/api/hello`, and `/api/smoke` without Error **1102** in the browser. OpenNext was **not** needed for this greenfield probe.

## What was run

| Step           | Result                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Scaffold       | `pnpm create vinext-app@latest spikes/cf-p1-next` with `--platform=cloudflare`, caches/images `none`, worker name `gloaming-cf-p1-spike` |
| Local build    | `pnpm run build` (vite/vinext) succeeded                                                                                                 |
| Local preview  | `vite preview` on `127.0.0.1:8787` — `/`, `/api/hello`, `/api/smoke` (cookie round-trip) **200**                                         |
| CF auth        | `cf auth login` (OAuth device flow) against account `Zhaoguiyang18@gmail.com's Account`                                                  |
| Preview deploy | `vinext-cloudflare previews deploy --preview-name p1-smoke` succeeded                                                                    |
| Preview URL    | `https://p1-smoke-gloaming-cf-p1-spike.zhaoguiyang18.workers.dev`                                                                        |

## Remote checks

| Check                     | Result                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| Browser → `/`             | HTML page title `vinext on Cloudflare Workers`; links present                                    |
| Browser → `/api/hello`    | `{"message":"Hello from vinext on Cloudflare Workers"}`                                          |
| Browser → `/api/smoke`    | `{"ok":true,"path":"/api/smoke",...,"runtime":"vinext-worker"}` — **no 1102**                    |
| Local `curl` → same hosts | DNS resolves; **TCP 443 connect timeout / fail** from this machine’s CLI path to `*.workers.dev` |

**Interpretation:** Deploy + Worker execution for this light path works. CLI reachability to `workers.dev` from the agent’s shell network was unreliable (likely path/filtering), while the IDE browser could reach the Preview. Do **not** treat “local curl timeout” as Free CPU failure.

## Answers to P1 questions

1. **OpenNext vs vinext:** For a **new** Cloudflare-ready Next probe, **vinext** smoke succeeded end-to-end. Prefer vinext first for greenfield; keep OpenNext as fallback if an existing Next app fails `vinext check`.
2. **Local build/start:** Yes (production build + `vite preview`).
3. **Preview / Free CPU / 1102:** Light page + Route Handlers **did not** return 1102 in browser. This does **not** prove Gloaming login/session or full assist/TTS paths fit Free **10 ms** CPU.
4. **Blockers relative to real repo (not fixed in P1):**
   - Current topology still `web` + Hono `api` + BullMQ `worker`
   - Native Azure Speech SDK
   - LangChain assist stack
   - Heavy Node assumptions / long jobs
   - Monorepo scaffolding caveat: `create-vinext-app` under the repo walked pnpm workspace (`../..`); keep future spikes isolated or restore root lockfile

## Cleanup intent

- Delete Preview `p1-smoke` / spike Worker `gloaming-cf-p1-spike` after recording findings
- Remove git worktree `.worktrees/cf-workers-p1` and branch `spike/cf-workers-p1`
- **Do not** merge probe app into default delivery

## Recommendation for P2

P1 unblocks writing a **migration slice backlog**, with explicit gates:

1. Prove vinext/`vinext check` against **real** `apps/web` (compatibility), not only a greenfield probe
2. Plan API host move to Next Route Handlers **without** Hono-as-end-state
3. Separate slices for TTS → Azure REST, assist → AI SDK, Discover on-demand
4. Treat Free CPU on **auth / session / DB** paths as a **paid-or-simplify** gate until measured on those real routes
5. Assume `workers.dev` CLI access may be flaky from some networks; use browser or non-blocked egress for smoke
