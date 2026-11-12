import { Hono } from 'hono';

import { getConfig, putConfig } from '@/server/domains/tts/config/service';
import { validatePutTtsConfig } from '@/server/domains/tts/validator';
import { type AuthVariables, requireAdmin } from '@/server/infra/http/middleware/auth';

export const ttsConfigRoutes = new Hono<{ Variables: AuthVariables }>();

ttsConfigRoutes.get('/api/admin/tts/config', requireAdmin, async (c) => {
  return c.json(await getConfig());
});

ttsConfigRoutes.put('/api/admin/tts/config', requireAdmin, validatePutTtsConfig, async (c) => {
  return c.json(await putConfig(c.req.valid('json')));
});
