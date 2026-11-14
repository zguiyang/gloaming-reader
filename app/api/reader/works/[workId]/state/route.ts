import { updateReadingStateBodySchema } from '@/shared/reader';

import { getReadingState, updateReadingState } from '@/server/domains/reading/reader';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { jsonOk, parseJsonBody } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { requireIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ workId: string }> };

export const GET = withApiError(async (request: Request, context: Ctx) => {
  const identity = await requireIdentity(request);
  const workId = pathId((await context.params).workId, 'workId');
  const actor = workReadActorFromIdentity(identity.user);
  const state = await getReadingState(actor, identity.user.id, workId);
  return jsonOk({ state });
});

export const PATCH = withApiError(async (request: Request, context: Ctx) => {
  const identity = await requireIdentity(request);
  const workId = pathId((await context.params).workId, 'workId');
  const parsed = await parseJsonBody(request, updateReadingStateBodySchema);
  if ('response' in parsed) return parsed.response;
  const actor = workReadActorFromIdentity(identity.user);
  const state = await updateReadingState(actor, identity.user.id, workId, parsed.data);
  return jsonOk(state);
});
