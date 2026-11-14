import { conversationListQuerySchema, createConversationBodySchema } from '@/shared/conversations';

import { createConversation, listConversations } from '@/server/domains/conversations/service';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { jsonOk, parseJsonBody, parseSearchParams } from '@/server/infra/http/next-json';
import { requireIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

export const POST = withApiError(async (request: Request) => {
  const identity = await requireIdentity(request);

  const parsed = await parseJsonBody(request, createConversationBodySchema);
  if ('response' in parsed) return parsed.response;

  const conversation = await createConversation(
    workReadActorFromIdentity(identity.user),
    identity.user.id,
    parsed.data,
  );
  return jsonOk(conversation, { status: HTTP_STATUS.CREATED });
});

export const GET = withApiError(async (request: Request) => {
  const identity = await requireIdentity(request);

  const url = new URL(request.url);
  const parsed = parseSearchParams(url, request, conversationListQuerySchema);
  if ('response' in parsed) return parsed.response;

  const data = await listConversations(workReadActorFromIdentity(identity.user), identity.user.id, parsed.data);
  return jsonOk(data);
});
