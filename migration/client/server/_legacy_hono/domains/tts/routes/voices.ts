import { Hono } from 'hono';

import { listVoicePresets } from '@/server/domains/tts/config/service';
import { type AuthVariables, requireAdmin } from '@/server/infra/http/middleware/auth';

export const ttsVoicesRoutes = new Hono<{ Variables: AuthVariables }>();

ttsVoicesRoutes.get('/api/admin/tts/voice-presets', requireAdmin, async (c) => {
  return c.json(listVoicePresets());
});
