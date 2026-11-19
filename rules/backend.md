# Backend services and APIs

Discover the affected capability, routing, middleware, validation, response, and
configuration owners from current source before changing behavior. For ownership
or dependency changes, also read [architecture rules](architecture.md).

## Current vs target (API placement)

| State       | Meaning                                                                                                                                                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Current** | HTTP APIs, auth assembly, and job enqueueing live at the **repo root** — Next Route Handlers under `app/api/**` calling `server/domains`. Optional BullMQ worker is the same package (`jobs/`).                                         |
| **Target**  | Same deploy unit on a conventional Node host (VPS) + managed data plane; optional Cloudflare DNS/CDN in front. Jobs optional for open-source delivery; if present, share DB/Redis with the web app. Hono is not the long-term API host. |

Deploy topology: [AGENTS.md](../AGENTS.md), [deployment.md](../docs/deployment.md). Product bans and safety remain in [AGENTS.md](../AGENTS.md).

**Do not:**

- Edit outside the owning path at the repo root unless a task explicitly moves a surface.
- Treat “embed Hono in Next” as the finished architecture. Nested Hono was
  removed from the live tree; do not reintroduce it.
- Reintroduce three long-lived API services as the recommended default. App +
  Jobs as two processes is fine.
- Default TTS onto Workers AI; prefer Azure Speech REST (`fetch`/SSML).
- Default assist/LLM onto LangChain or Workers AI; assist stack is Vercel AI SDK
  (`ai` + `@ai-sdk/openai`).
- Put HTTP-framework types in domain behavior; transport adapters
  (`app/api/**/route.ts`) stay thin.
- Reintroduce vinext / Workers as the app runtime.

## Application boundaries

- Application assembly, global middleware, and authentication setup connect
  capabilities; they do not own domain workflows.
- HTTP handlers validate transport input, invoke the owning capability, and
  return its response. Domain behavior must not depend on HTTP framework context
  or response helpers. Technical infrastructure must not import domain modules.
- Runtime workflow, queue, retry, lease, and provider execution policy belongs
  to the server application runtime (`server/**` and `jobs/**`), not shared
  contracts (`shared/`).

## API and authorization contracts

- Reuse the existing authentication integration rather than implementing parallel
  login or registration. Preserve its native endpoint contract.
- Every protected API enforces server-side authentication and the applicable
  role, ownership, and resource-access policy. Every admin API requires backend
  admin authorization; client gates, hidden navigation, and proxies are
  insufficient. Verify affected allowed and denied access cases.
- Validate structured input against the owning schemas before domain execution.
  Multipart and streaming boundaries also validate their transport constraints;
  do not duplicate shared validation policy locally.
- Project-owned APIs retain the owning error contract, including machine-readable
  codes, localized messages, validation details, and HTTP status semantics where
  defined. Discover response helpers, schemas, and consumer tests before changing
  response shapes or error behavior. Authentication-provider native responses
  retain their provider contract.

## Configuration and data integrity

- Use the existing validated configuration boundary and fail fast for invalid
  required configuration. Do not scatter environment reads or introduce
  per-variable getters. Add configuration only for actual runtime consumers.
  A narrow platform adapter may read conventional runtime variables when
  required to preserve inherited behavior.
- Preserve accepted persistence invariants, user/instance scope separation, and
  concurrency/conflict semantics when changing mutations or workflows. Consult
  current authoritative domain contracts and test the affected invariant; do not
  infer a new persistence policy from a handler or current database state.
- Environment authorization, secret protection, migrations, and automated-test
  isolation are governed by [AGENTS.md](../AGENTS.md).

## Redis key policy

Redis is for **cache, locks, rate limits, queues, and short-lived ops snapshots**
— not a second database. Durable domain data belongs in Postgres (or object
storage for large binaries).

**Do:**

- Give every application `SET` / write of a business or cache key a finite TTL
  (`EX` / absolute expiry). Prefer absolute TTLs that reads do not renew.
- Keep large cached values bounded (size cap + shorter TTL), as with TTS.
- Use Redis for coordination (locks with TTL + renewal, rate-limit windows,
  BullMQ with `removeOnComplete` / `removeOnFail`) and admin scan/cleanup
  snapshots that already expire.

**Do not:**

- Write permanent Redis keys (`SET` without expiry) for sessions, dictionaries,
  translations, TTS audio, or any other business payload.
- Use Redis as the sole long-term store when the product needs durable reuse —
  persist in Postgres (or S3 + DB metadata) and keep Redis as an optional L1
  cache with TTL.
- Put locks, rate limits, or BullMQ state into Postgres “for consistency” with
  this policy; those stay on Redis with their own lifecycles.
- Introduce a single catch-all “Redis mirror” table for unrelated domains.

Auth secondary storage (`server/infra/auth/secondary-storage.ts`) must always
apply a positive TTL (default/max aligned with Better Auth session lifetime).
