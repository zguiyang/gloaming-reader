# Rate-limit strategy — Next Route Handlers

Local cutover ports the old Hono policies into Next helpers. Auth and AI/API limits stay separate.

## Layers

| Layer           | Where                                                             | Behavior                                                                                                                                                                                                                                                                           |
| --------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Better Auth** | `server/infra/auth/auth.ts` → `rateLimit`                         | Built-in limiter on `/api/auth/*` via Redis secondary storage. **Disabled** when `FRONTEND_URL` host is `localhost` / `127.0.0.1` so local sign-in is not blocked by leftover Redis counters. Production / non-local hosts keep enabled with custom rules for sign-in/sign-up/etc. |
| **Guest API**   | `enforceGuestRateLimit` in `server/infra/http/next-rate-limit.ts` | Redis (`rate-limiter-flexible`) + in-process insurance. Applied to dictionary lookup for unauthenticated callers. Authenticated guests skip this policy (same as Hono).                                                                                                            |
| **AI streams**  | `acquireAiRateLimit` + `withAiRateLimitRelease`                   | Per-user + per-IP points, plus a Redis concurrency slot released when the SSE body ends (or on early validation/error). Wired on `POST /api/assist/ask` and `POST /api/translate/part`.                                                                                            |

## Policy numbers (MVP)

Same constants as legacy Hono middleware:

- `dictionaryLookup` guest: 60 / 10 min
- `assist`: 10 user / 60 IP per minute, max 2 concurrent
- `translate`: 20 user / 120 IP per minute, max 3 concurrent

Edit only `RATE_LIMIT_POLICIES` / `AI_RATE_LIMIT_POLICIES` in `next-rate-limit.ts`.

## Local ops notes

- Clear Redis keys `gloaming:ratelimit:*` (and Better Auth secondary keys) if a local session is stuck at 429.
- Client IP uses `x-real-ip` / `x-forwarded-for`; without a trusted proxy this is advisory only.
- This module assumes Node + Redis (not edge Workers rate limiting).

## Redis key policy (related)

Application Redis writes must use a finite TTL. Auth secondary storage never
writes permanent keys; sessions remain in Postgres. To find leftover `TTL=-1`
keys under `better-auth:`, `gloaming:`, and `asset-management:`:

```bash
pnpm exec tsx scripts/redis-no-ttl-scan.ts
# Optional (destructive): expire better-auth leftovers with the default session TTL
ALLOW_REDIS_NO_TTL_EXPIRE=1 pnpm exec tsx scripts/redis-no-ttl-scan.ts --expire-better-auth --execute
```

Normative rules: [rules/backend.md](../rules/backend.md) (Redis key policy).
