# `lib/` — client / cross-cutting runtime glue

Browser and RSC helpers: auth client, fetch wrappers, React Query, locale, `cn` utils.

**Not** the SSOT for UI↔server contracts (use `../shared`) and **not** server domain logic (use `../server`).

Must not import `server/domains`.
