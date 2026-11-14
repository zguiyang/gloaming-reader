import { updateLlmModelBodySchema } from '@/shared/llm';

import * as userLlmConfig from '@/server/domains/llm/config/user/service';
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
  const parsed = updateLlmModelBodySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error);
  }

  return jsonOk(await userLlmConfig.updateUserModel(identity.user.id, id, parsed.data));
});

export const DELETE = withApiError(async (request: Request, context: Ctx) => {
  const identity = await requireIdentity(request);
  const id = pathId((await context.params).id, 'id');
  await userLlmConfig.deleteUserModel(identity.user.id, id);
  return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
});
