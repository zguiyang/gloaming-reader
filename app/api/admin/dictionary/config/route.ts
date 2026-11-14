import { putDictionaryConfigBodySchema } from '@/shared/dictionary';

import { getDictionaryConfig, putDictionaryConfig } from '@/server/domains/dictionary/config/service';
import { jsonOk, jsonSchemaError } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

export const GET = withApiError(async (request: Request) => {
  const identity = await getRequestIdentity(request);
  assertAdmin(identity);
  return jsonOk(await getDictionaryConfig());
});

export const PUT = withApiError(async (request: Request) => {
  const identity = await getRequestIdentity(request);
  assertAdmin(identity);

  const raw = await request.json().catch(() => null);
  const parsed = putDictionaryConfigBodySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error);
  }

  return jsonOk(await putDictionaryConfig(parsed.data));
});
