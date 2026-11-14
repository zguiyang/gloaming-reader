import { getReaderParts } from '@/server/domains/reading/reader';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { jsonOk } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { getRequestIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ workId: string }> };

export const GET = withApiError(async (request: Request, context: Ctx) => {
  const workId = pathId((await context.params).workId, 'workId');
  const identity = await getRequestIdentity(request);
  const actor = workReadActorFromIdentity(identity.user);
  const data = await getReaderParts(actor, workId);
  return jsonOk(data);
});
