import { putTtsConfigBodySchema } from '@/shared/tts';

import { getUserConfig, putUserConfig } from '@/server/domains/tts/config/user-service';
import { jsonOk, parseJsonBody } from '@/server/infra/http/next-json';
import { requireIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

export const GET = withApiError(async (request: Request) => {
  const identity = await requireIdentity(request);
  return jsonOk(await getUserConfig(identity.user.id));
});

export const PUT = withApiError(async (request: Request) => {
  const identity = await requireIdentity(request);

  const parsed = await parseJsonBody(request, putTtsConfigBodySchema);
  if ('response' in parsed) return parsed.response;

  return jsonOk(await putUserConfig(identity.user.id, parsed.data));
});
