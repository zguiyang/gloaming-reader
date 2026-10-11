import { Hono } from 'hono';

import { getPublicCategory, listPublicCategories } from '@/domains/discovery/categories';
import { getSourceRecord, listSourceRecords } from '@/domains/discovery/read-model';
import { validateSourceRecordListQuery } from '@/domains/discovery/routes/validator';
import { resolveRequestLocale } from '@/infra/http/locale';
import type { AuthVariables } from '@/infra/http/middleware/auth';

export const discoveryRoutes = new Hono<{ Variables: AuthVariables }>();

export { discoveryAdminRoutes } from './admin';

/** Public Discover category list: stable id, localized display name, record count. */
discoveryRoutes.get('/api/discover/categories', async (c) => {
  return c.json(await listPublicCategories(resolveRequestLocale(c)));
});

/** Public Discover category detail, using the same minimal projection as the list. */
discoveryRoutes.get('/api/discover/categories/:categoryId', async (c) => {
  return c.json(await getPublicCategory(c.req.param('categoryId'), resolveRequestLocale(c)));
});

/** Public local SourceRecord list: search, pagination, explicit sort, category filter. */
discoveryRoutes.get('/api/discover/records', validateSourceRecordListQuery, async (c) => {
  const data = await listSourceRecords(c.req.valid('query'), { locale: resolveRequestLocale(c) });
  return c.json(data);
});

/** Public SourceRecord detail; `sourceRecordId` is distinct from a ReadingWork id. */
discoveryRoutes.get('/api/discover/records/:sourceRecordId', async (c) => {
  const record = await getSourceRecord(c.req.param('sourceRecordId'), { locale: resolveRequestLocale(c) });
  return c.json(record);
});
