import { putTtsConfigBodySchema } from '@/shared/tts';

import { getConfig, putConfig } from '@/server/domains/tts/config/service';
import { jsonOk, parseJsonBody } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

export const GET = withApiError(async (request: Request) => {
  const identity = await getRequestIdentity(request);
  assertAdmin(identity);
  return jsonOk(await getConfig());
});

export const PUT = withApiError(async (request: Request) => {
  const identity = await getRequestIdentity(request);
  assertAdmin(identity);

  const parsed = await parseJsonBody(request, putTtsConfigBodySchema);
  if ('response' in parsed) return parsed.response;

  return jsonOk(await putConfig(parsed.data));
});
