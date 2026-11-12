# P1 findings: Cloudflare Workers + vinext smoke

**Date:** 2026-11-12  
**Status:** P1 passed (with network caveat)  
**Branch/worktree used:** `spike/cf-workers-p1` @ `.worktrees/cf-workers-p1` (disposable; cleaned up)  
**Parent direction:** [`../cloudflare-fullstack-refactor-guidance.md`](../cloudflare-fullstack-refactor-guidance.md), [`../cloudflare-fullstack-refactor-stages.md`](../cloudflare-fullstack-refactor-stages.md)

## Summary

A **minimal new** vinext App Router probe (not `apps/web`) **built locally**, **deployed as a Worker Preview** on the authorized Cloudflare account, and **served** `/`, `/api/hello`, and `/api/smoke` without Error **1102** in the browser. OpenNext was **not** needed for this greenfield probe.

**What this proves:** Next-on-Workers is a viable **platform precondition** for a future app shaped like the north-star target.

**What this does not prove:** that today’s `web + Hono api + worker` stack can or should be lifted onto Workers as-is. That topology is not the migration object; refactor first, then platform-validate (**P4**).

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

**Interpretation:** Deploy + Worker execution for this light **probe** path works. CLI reachability to `workers.dev` from the agent’s shell network was unreliable (likely path/filtering), while the IDE browser could reach the Preview. Do **not** treat “local curl timeout” as Free CPU failure.

## Answers to P1 questions

1. **OpenNext vs vinext:** For a **new** Cloudflare-ready Next probe, **vinext** smoke succeeded end-to-end. Prefer vinext when later doing **P4** platform bring-up of a **refactored** app; keep OpenNext as fallback if needed then—not as a reason to vinext-check today’s `apps/web` before refactor.
2. **Local build/start:** Yes (production build + `vite preview`).
3. **Preview / Free CPU / 1102:** Light probe page + Route Handlers **did not** return 1102 in browser. This does **not** prove Gloaming login/session or full assist/TTS paths fit Free **10 ms** CPU. That measurement belongs in **P4** on the **refactored** app.
4. **Blockers relative to real repo (inputs for P3 refactor—not “migrate as-is” proof):**
   - Current topology still `web` + Hono `api` + BullMQ `worker` → **reshape in P3**, do not certify for CF lift
   - Native Azure Speech SDK → replace with REST in P3 (L5)
   - LangChain assist stack → replace with AI SDK in P3 (L6)
   - Heavy Node assumptions / long jobs → remove or defer (L2)
   - Monorepo scaffolding caveat: `create-vinext-app` under the repo walked pnpm workspace (`../..`); keep future spikes isolated or restore root lockfile

## Cleanup status

| Item                                                             | Status (2026-11-12)                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------- |
| Git worktree `.worktrees/cf-workers-p1`                          | Removed (directory empty / path gone)                   |
| Branch `spike/cf-workers-p1`                                     | Not present in local branch list                        |
| Probe app merge into default delivery                            | **Not done** (correct)                                  |
| Preview `p1-smoke` / Worker `gloaming-cf-p1-spike` on CF account | **Absent** — `cf workers scripts search --name gloaming | cf-p1 | spike`empty;`cf workers delete gloaming-cf-p1-spike` → 404「This Worker does not exist」. No further remote cleanup needed. |

## Recommendation for next phases

See [`../cloudflare-fullstack-refactor-stages.md`](../cloudflare-fullstack-refactor-stages.md) §4–§6（维护者方案：旁路新树）。

**Do next (P3), not CF compatibility of the current stack:**

1. **N0–N1:** Create self-contained **`migration/`** workspace（future extractable repo root）+ `client` with latest Next + shadcn；empty `jobs/`；own `packages/` as needed（§4.1.1）；keep root `apps/*` and root `packages/*` intact for comparison
2. **N2–N3:** Migrate foundation/styles, then frontend into `migration/client`
3. **N4:** Move HTTP APIs into `migration/client` Route Handlers（no Hono-as-end-state）；port shared packages into `migration/packages` on demand—do not leave permanent `file:` deps back to root packages
4. **T1–T3 while migrating:** AI SDK not LangChain；TTS Azure Speech REST/HTTP not native SDK；audit Workers-hostile deps
5. **N5:** Slim/remove old default delivery + make `migration/` extract-ready（explicit auth）

**Do later (P4), only after `migration/client` is largely migrated:**

6. Bring **`migration/client`** to Workers; measure real auth/session/DB and Free vs Paid
7. Use browser or non-blocked egress for `workers.dev` smoke if CLI paths are flaky

**Do not:**

- Run `vinext check` / CF compatibility against today’s `apps/web` as the next step
- Treat P1 probe success as proof the current three-service system can migrate
- Wire Jobs/BullMQ into the new tree in the scaffold phase
- Make the new client permanently depend on root `packages/*` via `file:` (breaks extract)
