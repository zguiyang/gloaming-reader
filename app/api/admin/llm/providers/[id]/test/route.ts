import { testLlmProviderBodySchema } from '@/shared/llm';

import * as llmProvidersService from '@/server/domains/llm/config/providers/service';
import { jsonOk, jsonSchemaError } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { enforceUserRateLimit } from '@/server/infra/http/next-rate-limit';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const POST = withApiError(async (request: Request, context: Ctx) => {
  const identity = await getRequestIdentity(request);
  assertAdmin(identity);
  const id = pathId((await context.params).id, 'id');

  const raw = await request.json().catch(() => null);
  const parsed = testLlmProviderBodySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error);
  }

  const limited = await enforceUserRateLimit(request, 'outboundProbe', identity.user.id);
  if (limited) {
    return limited;
  }

  return jsonOk(await llmProvidersService.testProvider(id, parsed.data));
});
