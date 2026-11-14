import { putLlmAppSettingBodySchema } from '@/shared/llm';

import * as userLlmConfig from '@/server/domains/llm/config/user/service';
import { jsonOk, parseJsonBody } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { requireIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ key: string }> };

export const PUT = withApiError(async (request: Request, context: Ctx) => {
  const identity = await requireIdentity(request);
  const key = pathId((await context.params).key, 'key');

  const parsed = await parseJsonBody(request, putLlmAppSettingBodySchema);
  if ('response' in parsed) return parsed.response;

  return jsonOk(await userLlmConfig.putUserSetting(identity.user.id, key, parsed.data));
});
