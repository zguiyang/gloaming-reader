import { Hono } from 'hono';

import { testTts } from '@/domains/tts/config/test-connection';
import { validateTestTts } from '@/domains/tts/validator';
import { type AuthVariables, requireAdmin } from '@/infra/http/middleware/auth';

export const ttsDiagnosticsRoutes = new Hono<{ Variables: AuthVariables }>();

ttsDiagnosticsRoutes.post('/api/admin/tts/test', requireAdmin, validateTestTts, async (c) => {
  const user = c.get('user');
  return c.json(await testTts(c.req.valid('json'), { userId: user?.id }));
});
