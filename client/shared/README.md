# `shared/` — in-app UI ↔ server contracts

Contracts used by both `features/` (and other UI) and `server/` / `app/api`.

**Put here:** DTOs, Zod schemas, error codes, API path constants, pure types and pure helpers shared across the UI/server boundary. Domain areas match former `@gloaming/shared/*` subpaths (`auth`, `works`, `reader`, …).

**Do not put:** React components, Next/Hono request types, DB access, secrets, or domain workflows.

**Must not import from:** `features/`, `server/`, or `components/`.

Import via `@/shared/<area>` (see `client/tsconfig.json` paths). See [STRUCTURE.md](../STRUCTURE.md).
