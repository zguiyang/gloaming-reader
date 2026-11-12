# `@gloaming/web`

Next.js App Router frontend for Gloaming (port **3000**).

## Scripts

```bash
pnpm --filter @gloaming/web dev
pnpm --filter @gloaming/web test
pnpm --filter @gloaming/web typecheck
pnpm --filter @gloaming/web lint
```

## Auth (session, soft UX)

See [`lib/auth/README.md`](./lib/auth/README.md).

- Soft: cookie presence in `proxy.ts`; client get-session + 401 → sign-in.
- Hard: Hono Better Auth session + `requireAuth` on protected API routes.
- Logout clears HttpOnly `better-auth.session_token` via Next `DELETE /api/auth/logout`.
