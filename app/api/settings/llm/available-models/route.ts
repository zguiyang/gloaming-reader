import * as userLlmConfig from '@/server/domains/llm/config/user/service';
import { jsonOk } from '@/server/infra/http/next-json';
import { requireIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

export const GET = withApiError(async (request: Request) => {
  await requireIdentity(request);
  return jsonOk(await userLlmConfig.listAvailableInstanceModels());
});
