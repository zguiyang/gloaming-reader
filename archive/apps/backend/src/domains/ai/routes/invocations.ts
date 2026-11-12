import { Hono } from 'hono';

import * as invocationLog from '@/domains/ai/invocations/log';
import { validateInvocationListQuery, validateInvocationStatsQuery } from '@/domains/ai/invocations/validator';
import { type AuthVariables, requireAdmin } from '@/infra/http/middleware/auth';

export const aiRoutes = new Hono<{ Variables: AuthVariables }>();

aiRoutes.get('/api/admin/ai/invocations/stats', requireAdmin, validateInvocationStatsQuery, async (c) => {
  return c.json(await invocationLog.getInvocationStats(c.req.valid('query')));
});

aiRoutes.get('/api/admin/ai/invocations', requireAdmin, validateInvocationListQuery, async (c) => {
  return c.json(await invocationLog.listInvocations(c.req.valid('query')));
});
