import { ttsInvocationStatsQuerySchema } from '@gloaming/shared/tts-invocations';

import { getTtsInvocationStats } from '@/server/domains/tts/log';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);

    const url = new URL(request.url);
    const parsed = ttsInvocationStatsQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'query',
          message: issue.message,
        })),
      );
    }

    return jsonOk(await getTtsInvocationStats(parsed.data));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
