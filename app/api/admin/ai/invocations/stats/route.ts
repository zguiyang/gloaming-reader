import { aiInvocationStatsQuerySchema } from '@/shared/ai-invocations';

import { getInvocationStats } from '@/server/domains/ai/invocations/log';
import { jsonOk, jsonSchemaError } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

export const GET = withApiError(async (request: Request) => {
  const identity = await getRequestIdentity(request);
  assertAdmin(identity);

  const url = new URL(request.url);
  const parsed = aiInvocationStatsQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error, 'query');
  }

  return jsonOk(await getInvocationStats(parsed.data));
});
