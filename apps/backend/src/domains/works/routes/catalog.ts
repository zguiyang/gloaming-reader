import { Hono } from 'hono';

import { workReadActorFromIdentity } from '@/domains/works/access';
import { getCatalogWork, listCatalogWorks } from '@/domains/works/catalog';
import { validateCatalogListQuery } from '@/domains/works/routes/validator';
import type { AuthVariables } from '@/infra/http/middleware/auth';

export const worksCatalogRoutes = new Hono<{ Variables: AuthVariables }>();

worksCatalogRoutes.get('/api/catalog/works', validateCatalogListQuery, async (c) => {
  const data = await listCatalogWorks(c.req.valid('query'));
  return c.json(data);
});

worksCatalogRoutes.get('/api/catalog/works/:id', async (c) => {
  const actor = workReadActorFromIdentity(c.get('user'));
  const work = await getCatalogWork(actor, c.req.param('id'));
  return c.json(work);
});
