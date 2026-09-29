import { Hono } from 'hono';

import { worksCatalogRoutes } from '@/domains/works/routes/catalog';
import { personalWorkRoutes } from '@/domains/works/routes/personal';
import type { AuthVariables } from '@/infra/http/middleware/auth';

export const worksRoutes = new Hono<{ Variables: AuthVariables }>();

worksRoutes.route('/', worksCatalogRoutes);
worksRoutes.route('/', personalWorkRoutes);
