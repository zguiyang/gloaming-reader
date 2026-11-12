import { Hono } from 'hono';

import * as conversationsService from '@/server/domains/conversations/service';
import { validateConversationListQuery, validateCreateConversation } from '@/server/domains/conversations/validator';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { type AuthVariables, requireAuth } from '@/server/infra/http/middleware/auth';
import { HTTP_STATUS } from '@/server/shared/constants';

export const conversationsRoutes = new Hono<{ Variables: AuthVariables }>();

conversationsRoutes.post('/api/conversations', requireAuth, validateCreateConversation, async (c) => {
  const user = c.get('user')!;
  const conversation = await conversationsService.createConversation(
    workReadActorFromIdentity(user),
    user.id,
    c.req.valid('json'),
  );
  return c.json(conversation, HTTP_STATUS.CREATED);
});

conversationsRoutes.get('/api/conversations', requireAuth, validateConversationListQuery, async (c) => {
  const user = c.get('user')!;
  const data = await conversationsService.listConversations(
    workReadActorFromIdentity(user),
    user.id,
    c.req.valid('query'),
  );
  return c.json(data);
});

conversationsRoutes.get('/api/conversations/:id', requireAuth, async (c) => {
  const user = c.get('user')!;
  const data = await conversationsService.getConversation(workReadActorFromIdentity(user), user.id, c.req.param('id'));
  return c.json(data);
});
