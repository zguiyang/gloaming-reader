import { createLlmProviderBodySchema } from '@/shared/llm';

import * as llmProvidersService from '@/server/domains/llm/config/providers/service';
import { jsonOk, parseJsonBody } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

export const GET = withApiError(async (request: Request) => {
  const identity = await getRequestIdentity(request);
  assertAdmin(identity);
  return jsonOk(await llmProvidersService.listProviders());
});

export const POST = withApiError(async (request: Request) => {
  const identity = await getRequestIdentity(request);
  assertAdmin(identity);

  const parsed = await parseJsonBody(request, createLlmProviderBodySchema);
  if ('response' in parsed) return parsed.response;

  const provider = await llmProvidersService.createProvider(parsed.data);
  return jsonOk(provider, { status: HTTP_STATUS.CREATED });
});
