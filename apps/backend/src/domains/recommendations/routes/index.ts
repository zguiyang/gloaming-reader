import { Hono } from 'hono';

import * as recommendationsService from '@/domains/recommendations/service';
import { validateRecommendationsQuery } from '@/domains/recommendations/validator';
import { type AuthVariables, requireAuth } from '@/infra/http/middleware/auth';

export const recommendationsRoutes = new Hono<{ Variables: AuthVariables }>();

recommendationsRoutes.get('/api/recommendations', requireAuth, validateRecommendationsQuery, async (c) => {
  const user = c.get('user')!;
  const query = c.req.valid('query');
  const data = await recommendationsService.getRecommendations(user.id, query);
  return c.json(data);
});
