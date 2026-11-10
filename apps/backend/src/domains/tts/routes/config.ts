import { Hono } from 'hono';

import { getConfig, putConfig } from '@/domains/tts/config/service';
import { validatePutTtsConfig } from '@/domains/tts/validator';
import { type AuthVariables, requireAdmin } from '@/infra/http/middleware/auth';

export const ttsConfigRoutes = new Hono<{ Variables: AuthVariables }>();

ttsConfigRoutes.get('/api/admin/tts/config', requireAdmin, async (c) => {
  return c.json(await getConfig());
});

ttsConfigRoutes.put('/api/admin/tts/config', requireAdmin, validatePutTtsConfig, async (c) => {
  return c.json(await putConfig(c.req.valid('json')));
});
