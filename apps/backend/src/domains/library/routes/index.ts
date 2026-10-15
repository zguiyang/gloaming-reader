import { Hono } from 'hono';

import { readSourceRecordSaveStatus, saveSourceRecordToLibrary } from '@/domains/library/save-intent';
import * as libraryService from '@/domains/library/service';
import { libraryTagRoutes } from '@/domains/library/tags/routes';
import { type AuthVariables, requireAuth } from '@/infra/http/middleware/auth';

export const libraryRoutes = new Hono<{ Variables: AuthVariables }>();

libraryRoutes.route('/', libraryTagRoutes);

libraryRoutes.get('/api/library', requireAuth, async (c) => {
  const user = c.get('user')!;
  const data = await libraryService.getLibrary(user.id);
  return c.json(data);
});

/** Save a SourceRecord by its Discover identity; membership follows once import is readable. */
libraryRoutes.post('/api/library/source-records/:sourceRecordId', requireAuth, async (c) => {
  const user = c.get('user')!;
  const result = await saveSourceRecordToLibrary(user.id, c.req.param('sourceRecordId'));
  return c.json(result);
});

/** Owner-scoped Save Intent status for refresh recovery and pending/failed feedback. */
libraryRoutes.get('/api/library/source-records/:sourceRecordId', requireAuth, async (c) => {
  const user = c.get('user')!;
  const status = await readSourceRecordSaveStatus(user.id, c.req.param('sourceRecordId'));
  return c.json(status);
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
