import { createLlmModelBodySchema, llmModelListQuerySchema } from '@/shared/llm';

import * as userLlmConfig from '@/server/domains/llm/config/user/service';
import { jsonOk, parseJsonBody, parseSearchParams } from '@/server/infra/http/next-json';
import { requireIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

export const GET = withApiError(async (request: Request) => {
  const identity = await requireIdentity(request);

  const url = new URL(request.url);
  const parsed = parseSearchParams(url, request, llmModelListQuerySchema);
  if ('response' in parsed) return parsed.response;

  return jsonOk(await userLlmConfig.listUserModels(identity.user.id, parsed.data));
});

export const POST = withApiError(async (request: Request) => {
  const identity = await requireIdentity(request);

  const parsed = await parseJsonBody(request, createLlmModelBodySchema);
  if ('response' in parsed) return parsed.response;

  const model = await userLlmConfig.createUserModel(identity.user.id, parsed.data);
  return jsonOk(model, { status: HTTP_STATUS.CREATED });
});
