import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { libraryBrowseQuerySchema } from '@gloaming/shared/library';

import { readSourceRecordSaveStatus, saveSourceRecordToLibrary } from '@/server/domains/library/save-intent';
import * as libraryService from '@/server/domains/library/service';
import { libraryTagRoutes } from '@/server/domains/library/tags/routes';
import { type AuthVariables, requireAuth } from '@/server/infra/http/middleware/auth';
import { sendValidationError } from '@/server/infra/http/response';

export const libraryRoutes = new Hono<{ Variables: AuthVariables }>();

libraryRoutes.route('/', libraryTagRoutes);

libraryRoutes.get('/api/library', requireAuth, async (c) => {
  const user = c.get('user')!;
  const data = await libraryService.getLibrary(user.id);
  return c.json(data);
});

libraryRoutes.get(
  '/api/library/browse',
  requireAuth,
  zValidator('query', libraryBrowseQuerySchema, (result, c) => {
    if (!result.success)
      return sendValidationError(
        c,
        result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      );
  }),
  async (c) => c.json(await libraryService.browseLibrary(c.get('user')!.id, c.req.valid('query'))),
);

libraryRoutes.get('/api/library/items/:workId', requireAuth, async (c) => {
  return c.json(await libraryService.getLibraryItem(c.get('user')!.id, c.req.param('workId')));
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
