# migration/

Extract staging tree for the next Gloaming repo root. Contents of this directory are intended to become the new repository root later.

## Layout

- `client/` — Next.js app (UI + future HTTP APIs)
- `jobs/` — empty placeholder (not used in this phase)
- `packages/` — shared packages (ported on demand; empty for scaffold)

## Commands

```bash
pnpm install
pnpm dev
```

Run from this directory (`migration/`). Do not point the new client at root `packages/*` via permanent `file:` deps.

## Notes

- `client` already depends on `ai` and `@ai-sdk/openai` for future assist work; no business wiring in the scaffold phase.
- Design SSOT copy: `DESIGN.md` in this directory.
- Theme tokens live in `client/app/globals.css` (ported from `apps/web`, without product reading styles).
