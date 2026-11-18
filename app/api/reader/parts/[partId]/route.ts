import { getReaderPart } from '@/server/domains/reading/reader';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { jsonOk } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { requireIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ partId: string }> };

export const GET = withApiError(async (request: Request, context: Ctx) => {
  const partId = pathId((await context.params).partId, 'partId');
  const identity = await requireIdentity(request);
  const actor = workReadActorFromIdentity(identity.user);
  const data = await getReaderPart(actor, partId);
  return jsonOk(data);
});
