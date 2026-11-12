# Backend services and APIs

Discover the affected capability, routing, middleware, validation, response, and
configuration owners from current source before changing behavior. For ownership
or dependency changes, also read [architecture rules](architecture.md).

## Current vs target (API placement)

| State       | Meaning                                                                                                                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Current** | HTTP APIs, auth assembly, and job enqueueing live in **`client/`** — Next Route Handlers under `app/api/**` calling `server/domains`. Optional BullMQ worker is the same package (`client/jobs/`).                    |
| **Target**  | Same deploy unit on managed data plane; platform goal is Cloudflare Workers. Jobs remain **optional** for open-source delivery; if present, they share DB/Redis with the web app. Hono is not the long-term API host. |

Deploy/API ownership direction and hard locks: [Cloudflare fullstack refactor guidance](../docs/cloudflare-fullstack-refactor-guidance.md). Product bans and safety remain in [AGENTS.md](../AGENTS.md).

**While evolving toward Workers:**

- Edit the owning path under `client/` unless a task explicitly moves a surface.
- Do not treat “embed Hono in Next” as the finished architecture. Nested Hono
  was removed from the live tree; do not reintroduce it.
- Do not reintroduce always-on BullMQ / three-service delivery as the recommended
  default (legacy layout is under `archive/apps/*` for comparison only).
- Do not default TTS onto Workers AI; prefer Azure Speech REST (`fetch`/SSML).
- Do not default assist/LLM onto LangChain or Workers AI; assist stack is
  Vercel AI SDK (`ai` + `@ai-sdk/openai`).
- Keep domain behavior free of HTTP-framework types; transport adapters
  (`app/api/**/route.ts`) stay thin.

## Application boundaries

- Application assembly, global middleware, and authentication setup connect
  capabilities; they do not own domain workflows.
- HTTP handlers validate transport input, invoke the owning capability, and
  return its response. Domain behavior must not depend on HTTP framework context
  or response helpers. Technical infrastructure must not import domain modules.
- Runtime workflow, queue, retry, lease, and provider execution policy belongs
  to the server application runtime (`client/server/**` and `client/jobs/**`),
  not shared contracts (`client/shared/`).

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
