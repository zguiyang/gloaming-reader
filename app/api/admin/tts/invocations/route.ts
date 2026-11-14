import { ttsInvocationListQuerySchema } from '@/shared/tts-invocations';

import { listTtsInvocations } from '@/server/domains/tts/log';
import { jsonOk, jsonSchemaError } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

export const GET = withApiError(async (request: Request) => {
  const identity = await getRequestIdentity(request);
  assertAdmin(identity);

  const url = new URL(request.url);
  const parsed = ttsInvocationListQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error, 'query');
  }

  return jsonOk(await listTtsInvocations(parsed.data));
});
