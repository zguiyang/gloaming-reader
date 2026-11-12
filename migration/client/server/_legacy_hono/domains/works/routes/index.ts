import { Hono } from 'hono';

import { worksCatalogRoutes } from '@/server/domains/works/routes/catalog';
import { personalWorkRoutes } from '@/server/domains/works/routes/personal';
import type { AuthVariables } from '@/server/infra/http/middleware/auth';

export const worksRoutes = new Hono<{ Variables: AuthVariables }>();

worksRoutes.route('/', worksCatalogRoutes);
worksRoutes.route('/', personalWorkRoutes);
