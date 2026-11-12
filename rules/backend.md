# Backend services and APIs

Discover the affected capability, routing, middleware, validation, response, and
configuration owners from current source before changing behavior. For ownership
or dependency changes, also read [architecture rules](architecture.md).

## Current vs target (API placement)

| State       | Meaning                                                                                                                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Current** | HTTP APIs, auth assembly, and job enqueueing live primarily in `apps/backend` (Hono). A separate worker process consumes BullMQ jobs. Web may proxy `/api/*`.                                                                     |
| **Target**  | All HTTP APIs belong in the Next application (Route Handlers / server modules). Hono is not the long-term API framework. Jobs are **not** the default open-source topology; if added later, they share DB/Redis with the web app. |

Deploy/API ownership direction and hard locks: [Cloudflare fullstack refactor guidance](../docs/cloudflare-fullstack-refactor-guidance.md). Product bans and safety remain in [AGENTS.md](../AGENTS.md).

**While migrating:**

- Edit the owning path that exists today unless a task explicitly moves a surface.
- Do not treat “embed Hono in Next” as the finished architecture.
- Do not reintroduce always-on BullMQ / three-service delivery as the recommended default.
- Do not default TTS onto Workers AI; prefer Azure Speech REST (`fetch`/SSML) when replacing the native Speech SDK.
- Do not default assist/LLM onto LangChain retention or Workers AI; target assist stack is Vercel AI SDK (`ai` + `@ai-sdk/openai`) when a task replaces the call layer.
- Keep domain behavior free of HTTP-framework types; transport adapters stay thin whether the host is Hono today or Next Route Handlers later.

## Application boundaries

- Application assembly, global middleware, and authentication setup connect
  capabilities; they do not own domain workflows.
- HTTP handlers validate transport input, invoke the owning capability, and
  return its response. Domain behavior must not depend on HTTP framework context
  or response helpers. Technical infrastructure must not import domain modules.
- Runtime workflow, queue, retry, lease, and provider execution policy belongs
  to the server application runtime, not shared contracts. Under the target
  topology, that policy lives with the single app (or an explicitly authorized
  optional Jobs process)—not in `@gloaming/shared`.

## API and authorization contracts

- Reuse the existing authentication integration rather than implementing parallel
  login or registration. Preserve its native endpoint contract.
- Every protected API enforces server-side authentication and the applicable
  role, ownership, and resource-access policy. Every admin API requires backend
  admin authorization; client gates, hidden navigation, and web proxies are
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
