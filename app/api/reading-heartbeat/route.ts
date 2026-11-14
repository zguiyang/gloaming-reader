import { readingHeartbeatBodySchema } from '@/shared/reading-history';

import { recordReadingHeartbeat } from '@/server/domains/reading/history/heartbeat';
import { jsonOk, jsonSchemaError } from '@/server/infra/http/next-json';
import { requireIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

export const POST = withApiError(async (request: Request) => {
  const identity = await requireIdentity(request);
  const parsed = readingHeartbeatBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error);
  }
  const result = await recordReadingHeartbeat(identity.user.id, parsed.data);
  return jsonOk(result);
});
