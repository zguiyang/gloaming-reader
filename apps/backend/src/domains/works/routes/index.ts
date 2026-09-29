import { Hono } from 'hono';

import { catalogAdminRoutes } from '@/domains/works/routes/admin';
import { worksCatalogRoutes } from '@/domains/works/routes/catalog';
import { personalWorkRoutes } from '@/domains/works/routes/personal';
import type { AuthVariables } from '@/infra/http/middleware/auth';

export const worksRoutes = new Hono<{ Variables: AuthVariables }>();

worksRoutes.route('/', catalogAdminRoutes);
worksRoutes.route('/', worksCatalogRoutes);
worksRoutes.route('/', personalWorkRoutes);
