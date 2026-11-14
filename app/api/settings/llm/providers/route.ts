import { createLlmProviderBodySchema } from '@/shared/llm';

import * as userLlmConfig from '@/server/domains/llm/config/user/service';
import { rejectOwnerUserIdInPayload } from '@/server/domains/provider-scope';
import { jsonOk, jsonSchemaError } from '@/server/infra/http/next-json';
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

  const raw = await request.json().catch(() => null);
  const parsed = createLlmProviderBodySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error);
  }

  rejectOwnerUserIdInPayload(parsed.data as Record<string, unknown>);
  const provider = await userLlmConfig.createUserProvider(identity.user.id, parsed.data);
  return jsonOk(provider, { status: HTTP_STATUS.CREATED });
});
