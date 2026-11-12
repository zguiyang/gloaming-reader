import { Hono } from 'hono';

import { readingHistoryAdminRoutes } from '@/domains/reading/routes/history/admin';
import { readingHistoryUserRoutes } from '@/domains/reading/routes/history/user';
import { type AuthVariables } from '@/infra/http/middleware/auth';

export const readingHistoryRoutes = new Hono<{ Variables: AuthVariables }>();

readingHistoryRoutes.route('/', readingHistoryUserRoutes);
readingHistoryRoutes.route('/', readingHistoryAdminRoutes);
