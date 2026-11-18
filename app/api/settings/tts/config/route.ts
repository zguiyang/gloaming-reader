import { putUserTtsVoicesBodySchema } from '@/shared/tts';

import { getUserVoices, putUserVoices } from '@/server/domains/tts/config/user-service';
import { jsonOk, parseJsonBody } from '@/server/infra/http/next-json';
import { requireIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

export const GET = withApiError(async (request: Request) => {
  const identity = await requireIdentity(request);
  return jsonOk(await getUserVoices(identity.user.id));
});

export const PUT = withApiError(async (request: Request) => {
  const identity = await requireIdentity(request);

  const parsed = await parseJsonBody(request, putUserTtsVoicesBodySchema);
  if ('response' in parsed) return parsed.response;

  return jsonOk(await putUserVoices(identity.user.id, parsed.data));
});
