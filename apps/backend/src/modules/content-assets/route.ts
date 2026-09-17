import { Hono } from 'hono';

import { type AuthVariables, requireAdmin } from '@/middleware/auth';
import { enqueuePartAudio, enqueueWorkAudio } from '@/modules/content-assets/audio-generation';
import * as contentAssetsService from '@/modules/content-assets/service';
import {
  validateGeneratePartAudio,
  validateGenerateWorkAudio,
  validateWorkAudioQuery,
} from '@/modules/content-assets/validator';

export const contentAssetsRoutes = new Hono<{ Variables: AuthVariables }>();

contentAssetsRoutes.get('/api/admin/parts/:partId/audio', requireAdmin, async (c) => {
  return c.json(await contentAssetsService.getPartAudio(c.req.param('partId')));
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
  return c.json(await contentAssetsService.getWorkAudio(c.req.param('workId'), role));
});

contentAssetsRoutes.post(
  '/api/admin/works/:workId/audio/generate',
  requireAdmin,
  validateGenerateWorkAudio,
  async (c) => {
    return c.json(await enqueueWorkAudio(c.req.param('workId'), c.req.valid('json')));
  },
);
