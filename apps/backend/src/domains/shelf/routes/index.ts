import { Hono } from 'hono';

import * as shelfService from '@/domains/shelf/service';
import { type AuthVariables, requireAuth } from '@/infra/http/middleware/auth';

export const shelfRoutes = new Hono<{ Variables: AuthVariables }>();

shelfRoutes.get('/api/shelf', requireAuth, async (c) => {
  const user = c.get('user')!;
  const data = await shelfService.getShelf(user.id);
  return c.json(data);
});
