import { Hono } from 'hono';

import * as libraryService from '@/domains/library/service';
import { type AuthVariables, requireAuth } from '@/infra/http/middleware/auth';

export const libraryRoutes = new Hono<{ Variables: AuthVariables }>();

libraryRoutes.get('/api/library', requireAuth, async (c) => {
  const user = c.get('user')!;
  const data = await libraryService.getLibrary(user.id);
  return c.json(data);
});

libraryRoutes.post('/api/library/:workId', requireAuth, async (c) => {
  const user = c.get('user')!;
  await libraryService.addToLibrary(user.id, c.req.param('workId'));
  return c.body(null, 204);
});

libraryRoutes.delete('/api/library/:workId', requireAuth, async (c) => {
  const user = c.get('user')!;
  await libraryService.removeFromLibrary(user.id, c.req.param('workId'));
  return c.body(null, 204);
});
