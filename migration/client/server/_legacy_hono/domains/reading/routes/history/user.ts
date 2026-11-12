import { Hono } from 'hono';

import { readingHeartbeatBodySchema } from '@gloaming/shared/reading-history';

import { recordReadingHeartbeat } from '@/server/domains/reading/history/heartbeat';
import { getReadingHistory } from '@/server/domains/reading/history/query';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { type AuthVariables, requireAuth } from '@/server/infra/http/middleware/auth';
import { sendValidationError } from '@/server/infra/http/response';

export const readingHistoryUserRoutes = new Hono<{ Variables: AuthVariables }>();

readingHistoryUserRoutes.get('/api/reading-history', requireAuth, async (c) => {
  const user = c.get('user')!;
  const data = await getReadingHistory(workReadActorFromIdentity(user), user.id);
  return c.json(data);
});

readingHistoryUserRoutes.post('/api/reading-heartbeat', requireAuth, async (c) => {
  const user = c.get('user')!;
  const parsed = readingHeartbeatBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return sendValidationError(
      c,
      parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  const result = await recordReadingHeartbeat(user.id, parsed.data);
  return c.json(result);
});
