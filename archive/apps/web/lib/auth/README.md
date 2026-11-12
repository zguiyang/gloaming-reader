# Auth (`apps/web/lib/auth`)

Frontend only does **soft UX** + Better Auth **client**. Real auth is Hono Better Auth on `/api/auth/*`.

| Layer                     | Behavior                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `proxy.ts`                | Rewrite `/api/*` → Hono; public page access is not gated here                              |
| `baClient` / façade       | `better-auth/react` → same-origin `/api/auth/*`; shared session atom (no extra store)      |
| `useSession` / forms      | Soft UX from the shared atom; prefer lifting `userId` props over leaf re-subscribe         |
| Backend session cache     | Redis secondary storage (Postgres durable); cookie cache skipped so revoke stays immediate |
| `DELETE /api/auth/logout` | Next clears `better-auth.session_token`, then calls Hono `POST /api/auth/sign-out`         |

Do not treat proxy or client checks as security controls — API authz is `requireAuth` on Hono.
