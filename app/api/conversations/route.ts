import { conversationListQuerySchema, createConversationBodySchema } from '@/shared/conversations';

import { createConversation, listConversations } from '@/server/domains/conversations/service';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);

    const raw = await request.json().catch(() => null);
    const parsed = createConversationBodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }

    const conversation = await createConversation(
      workReadActorFromIdentity(identity.user),
      identity.user.id,
      parsed.data,
    );
    return jsonOk(conversation, { status: HTTP_STATUS.CREATED });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}

export async function GET(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);

    const url = new URL(request.url);
    const parsed = conversationListQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'query',
          message: issue.message,
        })),
      );
    }

    const data = await listConversations(workReadActorFromIdentity(identity.user), identity.user.id, parsed.data);
    return jsonOk(data);
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
