import { getConversation } from '@/server/domains/conversations/service';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const { id } = await context.params;
    const data = await getConversation(workReadActorFromIdentity(identity.user), identity.user.id, id);
    return jsonOk(data);
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
