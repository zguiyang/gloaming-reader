import { updateLlmProviderBodySchema } from '@/shared/llm';

import * as userLlmConfig from '@/server/domains/llm/config/user/service';
import { rejectOwnerUserIdInPayload } from '@/server/domains/provider-scope';
import { jsonOk, jsonSchemaError } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { requireIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withApiError(async (request: Request, context: Ctx) => {
  const identity = await requireIdentity(request);
  const id = pathId((await context.params).id, 'id');

  const raw = await request.json().catch(() => null);
  const parsed = updateLlmProviderBodySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error);
  }

  rejectOwnerUserIdInPayload(parsed.data as Record<string, unknown>);
  return jsonOk(await userLlmConfig.updateUserProvider(identity.user.id, id, parsed.data));
});

export const DELETE = withApiError(async (request: Request, context: Ctx) => {
  const identity = await requireIdentity(request);
  const id = pathId((await context.params).id, 'id');
  await userLlmConfig.deleteUserProvider(identity.user.id, id);
  return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
});
