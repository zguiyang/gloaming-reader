import { putLlmAppSettingBodySchema } from '@/shared/llm';

import * as userLlmConfig from '@/server/domains/llm/config/user/service';
import { jsonOk, jsonSchemaError } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { requireIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ key: string }> };

export const PUT = withApiError(async (request: Request, context: Ctx) => {
  const identity = await requireIdentity(request);
  const key = pathId((await context.params).key, 'key');

  const raw = await request.json().catch(() => null);
  const parsed = putLlmAppSettingBodySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error);
  }

  return jsonOk(await userLlmConfig.putUserSetting(identity.user.id, key, parsed.data));
});
