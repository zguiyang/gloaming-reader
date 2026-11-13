import * as llmProvidersService from '@/server/domains/llm/config/providers/service';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { enforceUserRateLimit } from '@/server/infra/http/next-rate-limit';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);

    const limited = await enforceUserRateLimit(request, 'outboundProbe', identity.user.id);
    if (limited) {
      return limited;
    }

    const id = pathId((await context.params).id, 'id');
    return jsonOk(await llmProvidersService.queryProviderBalance(id));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
