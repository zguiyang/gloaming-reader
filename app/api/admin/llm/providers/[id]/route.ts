import { updateLlmProviderBodySchema } from '@/shared/llm';

import * as llmProvidersService from '@/server/domains/llm/config/providers/service';
import { jsonFromThrown, jsonOk, parseJsonBody } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withApiError(async (request: Request, context: Ctx) => {
  const identity = await getRequestIdentity(request);
  assertAdmin(identity);
  const id = pathId((await context.params).id, 'id');

  const parsed = await parseJsonBody(request, updateLlmProviderBodySchema);
  if ('response' in parsed) return parsed.response;

  return jsonOk(await llmProvidersService.updateProvider(id, parsed.data));
});

export async function DELETE(_request: Request, context: Ctx) {
  const request = _request;
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    const id = pathId((await context.params).id, 'id');
    await llmProvidersService.deleteProvider(id);
    return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
