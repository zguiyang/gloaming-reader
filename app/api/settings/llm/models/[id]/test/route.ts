import * as userLlmConfig from '@/server/domains/llm/config/user/service';
import { jsonOk } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { enforceUserRateLimit } from '@/server/infra/http/next-rate-limit';
import { requireIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const POST = withApiError(async (request: Request, context: Ctx) => {
  const identity = await requireIdentity(request);

  const limited = await enforceUserRateLimit(request, 'outboundProbe', identity.user.id);
  if (limited) {
    return limited;
  }

  const id = pathId((await context.params).id, 'id');
  return jsonOk(await userLlmConfig.testUserModel(identity.user.id, id));
});
