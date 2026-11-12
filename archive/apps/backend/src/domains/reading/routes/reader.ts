import { Hono } from 'hono';

import {
  getReaderPart,
  getReaderParts,
  getReadingState,
  updateReadingState,
  validateUpdateReadingState,
} from '@/domains/reading/reader';
import { workReadActorFromIdentity } from '@/domains/works/access';
import { type AuthVariables, requireAuth } from '@/infra/http/middleware/auth';

export const readerRoutes = new Hono<{ Variables: AuthVariables }>();

readerRoutes.get('/api/reader/works/:workId/parts', async (c) => {
  const actor = workReadActorFromIdentity(c.get('user'));
  const data = await getReaderParts(actor, c.req.param('workId'));
  return c.json(data);
});

readerRoutes.get('/api/reader/works/:workId/state', requireAuth, async (c) => {
  const user = c.get('user')!;
  const actor = workReadActorFromIdentity(user);
  const state = await getReadingState(actor, user.id, c.req.param('workId'));
  return c.json({ state });
});

readerRoutes.patch('/api/reader/works/:workId/state', requireAuth, validateUpdateReadingState, async (c) => {
  const user = c.get('user')!;
  const actor = workReadActorFromIdentity(user);
  const state = await updateReadingState(actor, user.id, c.req.param('workId'), c.req.valid('json'));
  return c.json(state);
});

readerRoutes.get('/api/reader/parts/:partId', async (c) => {
  const actor = workReadActorFromIdentity(c.get('user'));
  const data = await getReaderPart(actor, c.req.param('partId'));
  return c.json(data);
});
