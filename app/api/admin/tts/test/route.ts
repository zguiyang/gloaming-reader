import { testTtsBodySchema } from '@/shared/tts';

import { testTts } from '@/server/domains/tts/config/test-connection';
import { jsonOk, jsonSchemaError } from '@/server/infra/http/next-json';
import { enforceUserRateLimit } from '@/server/infra/http/next-rate-limit';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

export const POST = withApiError(async (request: Request) => {
  const identity = await getRequestIdentity(request);
  assertAdmin(identity);

  const raw = await request.json().catch(() => null);
  const parsed = testTtsBodySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error);
  }

  const limited = await enforceUserRateLimit(request, 'outboundProbe', identity.user.id);
  if (limited) {
    return limited;
  }

  return jsonOk(await testTts(parsed.data, { auditActorUserId: identity.user.id }));
});
