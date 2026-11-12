import { readingHeartbeatBodySchema } from '@/shared/reading-history';

import { recordReadingHeartbeat } from '@/server/domains/reading/history/heartbeat';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const parsed = readingHeartbeatBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }
    const result = await recordReadingHeartbeat(identity.user.id, parsed.data);
    return jsonOk(result);
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
