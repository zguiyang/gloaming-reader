import { testTtsBodySchema } from '@gloaming/shared/tts';

import { testTts } from '@/server/domains/tts/config/test-connection';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);

    const raw = await request.json().catch(() => null);
    const parsed = testTtsBodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }

    return jsonOk(await testTts(parsed.data, { auditActorUserId: identity.user?.id }));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
