# `shared/` — in-app UI ↔ server contracts

Contracts used by both `features/` (and other UI) and `server/` / `app/api`.

**Put here:** DTOs, Zod schemas, error codes, API path constants, pure types and pure helpers shared across the UI/server boundary.

**Do not put:** React components, Next/Hono request types, DB access, secrets, or domain workflows.

**Must not import from:** `features/`, `server/`, or `components/`.

For cross-package authority (`client` + future `jobs`, or extractable packages), use `packages/*` instead. See [STRUCTURE.md](../STRUCTURE.md).
