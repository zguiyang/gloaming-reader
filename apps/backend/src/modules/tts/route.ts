import { Hono } from 'hono';

import { type AuthVariables, requireAdmin } from '@/middleware/auth';
import { getConfig, listVoicePresets, putConfig } from '@/modules/tts/config/service';
import { testTts } from '@/modules/tts/config/test-connection';
import * as ttsLog from '@/modules/tts/log';
import {
  validatePutTtsConfig,
  validateTestTts,
  validateTtsInvocationListQuery,
  validateTtsInvocationStatsQuery,
} from '@/modules/tts/validator';

export const ttsRoutes = new Hono<{ Variables: AuthVariables }>();

ttsRoutes.get('/api/admin/tts/config', requireAdmin, async (c) => {
  return c.json(await getConfig());
});

ttsRoutes.put('/api/admin/tts/config', requireAdmin, validatePutTtsConfig, async (c) => {
  return c.json(await putConfig(c.req.valid('json')));
});

ttsRoutes.get('/api/admin/tts/voice-presets', requireAdmin, async (c) => {
  return c.json(listVoicePresets());
});

ttsRoutes.post('/api/admin/tts/test', requireAdmin, validateTestTts, async (c) => {
  const user = c.get('user');
  return c.json(await testTts(c.req.valid('json'), { userId: user?.id }));
});

ttsRoutes.get('/api/admin/tts/invocations/stats', requireAdmin, validateTtsInvocationStatsQuery, async (c) => {
  return c.json(await ttsLog.getTtsInvocationStats(c.req.valid('query')));
});

ttsRoutes.get('/api/admin/tts/invocations', requireAdmin, validateTtsInvocationListQuery, async (c) => {
  return c.json(await ttsLog.listTtsInvocations(c.req.valid('query')));
});
