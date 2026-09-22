import { Hono } from 'hono';

import {
  enqueuePartAudio,
  enqueueWorkAudio,
  getPartAudio,
  getWorkAudio,
  validateGeneratePartAudio,
  validateGenerateWorkAudio,
  validateWorkAudioQuery,
} from '@/domains/assets';
import { type AuthVariables, requireAdmin } from '@/infra/http/middleware/auth';

export const contentAssetsRoutes = new Hono<{ Variables: AuthVariables }>();

contentAssetsRoutes.get('/api/admin/parts/:partId/audio', requireAdmin, async (c) => {
  return c.json(await getPartAudio(c.req.param('partId')));
});

contentAssetsRoutes.post(
  '/api/admin/parts/:partId/audio/generate',
  requireAdmin,
  validateGeneratePartAudio,
  async (c) => {
    return c.json(await enqueuePartAudio(c.req.param('partId'), c.req.valid('json')));
  },
);

contentAssetsRoutes.get('/api/admin/works/:workId/audio', requireAdmin, validateWorkAudioQuery, async (c) => {
  const { role } = c.req.valid('query');
  return c.json(await getWorkAudio(c.req.param('workId'), role));
});

contentAssetsRoutes.post(
  '/api/admin/works/:workId/audio/generate',
  requireAdmin,
  validateGenerateWorkAudio,
  async (c) => {
    return c.json(await enqueueWorkAudio(c.req.param('workId'), c.req.valid('json')));
  },
);
