import { Hono } from 'hono';

import * as llmSettingsService from '@/domains/llm/config/settings/service';
import { validatePutSetting } from '@/domains/llm/config/validator';
import { type AuthVariables, requireAdmin } from '@/infra/http/middleware/auth';

export const llmSettingsRoutes = new Hono<{ Variables: AuthVariables }>();

llmSettingsRoutes.get('/api/admin/llm/settings', requireAdmin, async (c) => {
  return c.json(await llmSettingsService.listSettings());
});

llmSettingsRoutes.put('/api/admin/llm/settings/:key', requireAdmin, validatePutSetting, async (c) => {
  const setting = await llmSettingsService.putSetting(c.req.param('key'), c.req.valid('json'));
  return c.json(setting);
});
