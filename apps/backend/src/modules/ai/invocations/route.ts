import { Hono } from 'hono';

import { type AuthVariables, requireAdmin } from '@/middleware/auth';
import * as invocationLog from '@/modules/ai/invocations/log';
import { validateInvocationListQuery, validateInvocationStatsQuery } from '@/modules/ai/invocations/validator';

export const aiRoutes = new Hono<{ Variables: AuthVariables }>();

aiRoutes.get('/api/admin/ai/invocations/stats', requireAdmin, validateInvocationStatsQuery, async (c) => {
  return c.json(await invocationLog.getInvocationStats(c.req.valid('query')));
});

aiRoutes.get('/api/admin/ai/invocations', requireAdmin, validateInvocationListQuery, async (c) => {
  return c.json(await invocationLog.listInvocations(c.req.valid('query')));
});
