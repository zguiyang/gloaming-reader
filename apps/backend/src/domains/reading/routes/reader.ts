import { Hono } from 'hono';

import { readerPartAudioQuerySchema } from '@gloaming/shared/reader';

import * as readerService from '@/domains/reading/reader/service';
import { validateUpdateReadingState } from '@/domains/reading/reader/validator';
import { type AuthVariables, requireAuth } from '@/infra/http/middleware/auth';

export const readerRoutes = new Hono<{ Variables: AuthVariables }>();

readerRoutes.get('/api/reader/works/:workId/parts', async (c) => {
  const data = await readerService.getReaderParts(c.req.param('workId'));
  return c.json(data);
});

readerRoutes.get('/api/reader/works/:workId/state', requireAuth, async (c) => {
  const user = c.get('user')!;
  const state = await readerService.getReadingState(user.id, c.req.param('workId'));
  return c.json({ state });
});

readerRoutes.patch('/api/reader/works/:workId/state', requireAuth, validateUpdateReadingState, async (c) => {
  const user = c.get('user')!;
  const state = await readerService.updateReadingState(user.id, c.req.param('workId'), c.req.valid('json'));
  return c.json(state);
});

readerRoutes.get('/api/reader/parts/:partId', async (c) => {
  const data = await readerService.getReaderPart(c.req.param('partId'));
  return c.json(data);
});

readerRoutes.get('/api/reader/parts/:partId/audio', async (c) => {
  const query = readerPartAudioQuerySchema.parse({ role: c.req.query('role') });
  const track = await readerService.getPublishedPartAudioTrack(c.req.param('partId'), query.role);
  return c.json(track);
});
