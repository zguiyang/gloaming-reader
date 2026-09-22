import { Hono } from 'hono';

import {
  getPublishedWork,
  listCatalogCategories,
  listCatalogTags,
  listCatalogWorks,
} from '@/domains/works/catalog/catalog';
import { validateCatalogListQuery } from '@/domains/works/routes/validator';
import type { AuthVariables } from '@/infra/http/middleware/auth';

export const worksCatalogRoutes = new Hono<{ Variables: AuthVariables }>();

worksCatalogRoutes.get('/api/catalog/tags', async (c) => {
  const data = await listCatalogTags();
  return c.json(data);
});

worksCatalogRoutes.get('/api/catalog/categories', async (c) => {
  const data = await listCatalogCategories();
  return c.json(data);
});

worksCatalogRoutes.get('/api/catalog/works', validateCatalogListQuery, async (c) => {
  const data = await listCatalogWorks(c.req.valid('query'));
  return c.json(data);
});

worksCatalogRoutes.get('/api/catalog/works/:id', async (c) => {
  const work = await getPublishedWork(c.req.param('id'));
  return c.json(work);
});
