import { Hono } from 'hono';

import * as conversationsService from '@/domains/conversations/service';
import { validateConversationListQuery, validateCreateConversation } from '@/domains/conversations/validator';
import { type AuthVariables, requireAuth } from '@/infra/http/middleware/auth';
import { HTTP_STATUS } from '@/shared/constants';

export const conversationsRoutes = new Hono<{ Variables: AuthVariables }>();

conversationsRoutes.post('/api/conversations', requireAuth, validateCreateConversation, async (c) => {
  const user = c.get('user')!;
  const conversation = await conversationsService.createConversation(user.id, c.req.valid('json'));
  return c.json(conversation, HTTP_STATUS.CREATED);
});

conversationsRoutes.get('/api/conversations', requireAuth, validateConversationListQuery, async (c) => {
  const user = c.get('user')!;
  const data = await conversationsService.listConversations(user.id, c.req.valid('query'));
  return c.json(data);
});

conversationsRoutes.get('/api/conversations/:id', requireAuth, async (c) => {
  const user = c.get('user')!;
  const data = await conversationsService.getConversation(user.id, c.req.param('id'));
  return c.json(data);
});
