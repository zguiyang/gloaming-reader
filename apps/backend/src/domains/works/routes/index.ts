import { Hono } from 'hono';

import { worksAdminRoutes } from '@/domains/works/routes/admin';
import { worksCatalogRoutes } from '@/domains/works/routes/catalog';
import type { AuthVariables } from '@/infra/http/middleware/auth';

export const worksRoutes = new Hono<{ Variables: AuthVariables }>();

worksRoutes.route('/', worksAdminRoutes);
worksRoutes.route('/', worksCatalogRoutes);
