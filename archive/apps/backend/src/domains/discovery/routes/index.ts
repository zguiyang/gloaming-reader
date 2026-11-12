import { Hono } from 'hono';

import { getPublicCategory, listPublicCategories } from '@/domains/discovery/categories';
import { getSourceRecord, listSourceRecords } from '@/domains/discovery/read-model';
import { validatePublicCategoryListQuery, validateSourceRecordListQuery } from '@/domains/discovery/routes/validator';
import { workReadActorFromIdentity } from '@/domains/works/access';
import { resolveRequestLocale } from '@/infra/http/locale';
import type { AuthVariables } from '@/infra/http/middleware/auth';

export const discoveryRoutes = new Hono<{ Variables: AuthVariables }>();

export { discoveryAdminRoutes } from './admin';

/** Public Discover category list: stable id, localized display name, record count. */
discoveryRoutes.get('/api/discover/categories', validatePublicCategoryListQuery, async (c) => {
  const { language } = c.req.valid('query');
  return c.json(await listPublicCategories(resolveRequestLocale(c), language));
});

/** Public Discover category detail, using the same minimal projection as the list. */
discoveryRoutes.get('/api/discover/categories/:categoryId', validatePublicCategoryListQuery, async (c) => {
  const { language } = c.req.valid('query');
  return c.json(await getPublicCategory(c.req.param('categoryId'), resolveRequestLocale(c), language));
});

/** Public local SourceRecord list: search, pagination, explicit sort, category filter. */
discoveryRoutes.get('/api/discover/records', validateSourceRecordListQuery, async (c) => {
  const data = await listSourceRecords(c.req.valid('query'), {
    locale: resolveRequestLocale(c),
    actor: workReadActorFromIdentity(c.get('user')),
  });
  return c.json(data);
});

/** Public SourceRecord detail; `sourceRecordId` is distinct from a ReadingWork id. */
discoveryRoutes.get('/api/discover/records/:sourceRecordId', async (c) => {
  const record = await getSourceRecord(c.req.param('sourceRecordId'), {
    locale: resolveRequestLocale(c),
    actor: workReadActorFromIdentity(c.get('user')),
  });
  return c.json(record);
});
