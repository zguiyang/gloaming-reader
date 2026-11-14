import { conversationListQuerySchema, createConversationBodySchema } from '@/shared/conversations';

import { createConversation, listConversations } from '@/server/domains/conversations/service';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { jsonOk, jsonSchemaError } from '@/server/infra/http/next-json';
import { requireIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

export const POST = withApiError(async (request: Request) => {
  const identity = await requireIdentity(request);

  const raw = await request.json().catch(() => null);
  const parsed = createConversationBodySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error);
  }

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
  const parsed = conversationListQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error, 'query');
  }

  const data = await listConversations(workReadActorFromIdentity(identity.user), identity.user.id, parsed.data);
  return jsonOk(data);
});
