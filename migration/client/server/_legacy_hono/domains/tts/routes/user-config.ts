import { Hono } from 'hono';

import { getUserConfig, putUserConfig } from '@/server/domains/tts/config/user-service';
import { validatePutTtsConfig } from '@/server/domains/tts/validator';
import { type AuthVariables, requireAuth } from '@/server/infra/http/middleware/auth';

export const ttsUserConfigRoutes = new Hono<{ Variables: AuthVariables }>();

ttsUserConfigRoutes.get('/api/settings/tts/config', requireAuth, async (c) => {
  const user = c.get('user')!;
  return c.json(await getUserConfig(user.id));
});

ttsUserConfigRoutes.put('/api/settings/tts/config', requireAuth, validatePutTtsConfig, async (c) => {
  const user = c.get('user')!;
  return c.json(await putUserConfig(user.id, c.req.valid('json')));
});
