import { createLlmProviderBodySchema } from '@/shared/llm';

import * as userLlmConfig from '@/server/domains/llm/config/user/service';
import { rejectOwnerUserIdInPayload } from '@/server/domains/provider-scope';
import { jsonOk, parseJsonBody } from '@/server/infra/http/next-json';
import { requireIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

export const GET = withApiError(async (request: Request) => {
  const identity = await requireIdentity(request);
  return jsonOk(await userLlmConfig.listUserProviders(identity.user.id));
});

export const POST = withApiError(async (request: Request) => {
  const identity = await requireIdentity(request);

  const parsed = await parseJsonBody(request, createLlmProviderBodySchema);
  if ('response' in parsed) return parsed.response;

  rejectOwnerUserIdInPayload(parsed.data as Record<string, unknown>);
  const provider = await userLlmConfig.createUserProvider(identity.user.id, parsed.data);
  return jsonOk(provider, { status: HTTP_STATUS.CREATED });
});
