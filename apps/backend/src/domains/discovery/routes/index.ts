import { Hono } from 'hono';

import { getSourceRecord, listSourceRecords } from '@/domains/discovery/read-model';
import { validateSourceRecordListQuery } from '@/domains/discovery/routes/validator';
import type { AuthVariables } from '@/infra/http/middleware/auth';

export const discoveryRoutes = new Hono<{ Variables: AuthVariables }>();

export { discoveryAdminRoutes } from './admin';

/** Public local SourceRecord list: search, pagination, explicit sort, English-first. */
discoveryRoutes.get('/api/discover/records', validateSourceRecordListQuery, async (c) => {
  const data = await listSourceRecords(c.req.valid('query'));
  return c.json(data);
});

/** Public SourceRecord detail; `sourceRecordId` is distinct from a ReadingWork id. */
discoveryRoutes.get('/api/discover/records/:sourceRecordId', async (c) => {
  const record = await getSourceRecord(c.req.param('sourceRecordId'));
  return c.json(record);
});
