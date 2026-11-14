import { getConversation } from '@/server/domains/conversations/service';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { jsonOk } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { requireIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = withApiError(async (request: Request, context: Ctx) => {
  const identity = await requireIdentity(request);
  const id = pathId((await context.params).id, 'id');
  const data = await getConversation(workReadActorFromIdentity(identity.user), identity.user.id, id);
  return jsonOk(data);
});
