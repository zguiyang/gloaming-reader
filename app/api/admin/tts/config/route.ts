import { putTtsConfigBodySchema } from '@/shared/tts';

import { getConfig, putConfig } from '@/server/domains/tts/config/service';
import { jsonOk, jsonSchemaError } from '@/server/infra/http/next-json';
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

  const raw = await request.json().catch(() => null);
  const parsed = putTtsConfigBodySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error);
  }

  return jsonOk(await putConfig(parsed.data));
});
