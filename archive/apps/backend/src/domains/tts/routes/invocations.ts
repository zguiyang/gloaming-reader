import { Hono } from 'hono';

import * as ttsLog from '@/domains/tts/log';
import { validateTtsInvocationListQuery, validateTtsInvocationStatsQuery } from '@/domains/tts/validator';
import { type AuthVariables, requireAdmin } from '@/infra/http/middleware/auth';

export const ttsInvocationsRoutes = new Hono<{ Variables: AuthVariables }>();

ttsInvocationsRoutes.get(
  '/api/admin/tts/invocations/stats',
  requireAdmin,
  validateTtsInvocationStatsQuery,
  async (c) => {
    return c.json(await ttsLog.getTtsInvocationStats(c.req.valid('query')));
  },
);

ttsInvocationsRoutes.get('/api/admin/tts/invocations', requireAdmin, validateTtsInvocationListQuery, async (c) => {
  return c.json(await ttsLog.listTtsInvocations(c.req.valid('query')));
});
