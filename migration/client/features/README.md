# `features/` — product UI

Domain UI and client orchestration migrated from `apps/web/features` during **N2–N3**.

**May import:** `../shared`, `../lib`, `../components`, `../constants`.

**Must not import:** `../server` or `server/domains` internals. Talk to the backend via same-origin `/api/*` (and later Route Handlers).

Empty until feature migration starts.
