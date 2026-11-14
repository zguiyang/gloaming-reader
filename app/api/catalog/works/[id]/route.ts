import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { getCatalogWork } from '@/server/domains/works/catalog';
import { jsonOk } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { getRequestIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = withApiError(async (request: Request, context: Ctx) => {
  const id = pathId((await context.params).id, 'id');
  const identity = await getRequestIdentity(request);
  const actor = workReadActorFromIdentity(identity.user);
  const work = await getCatalogWork(actor, id);
  return jsonOk(work);
});
