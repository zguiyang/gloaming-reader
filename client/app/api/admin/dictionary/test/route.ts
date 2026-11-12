import { testDictionaryBodySchema } from '@gloaming/shared/dictionary';

import { testDictionary } from '@/server/domains/dictionary/lookup/service';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);

    const raw = await request.json().catch(() => null);
    const parsed = testDictionaryBodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }

    return jsonOk(await testDictionary(workReadActorFromIdentity(identity.user), parsed.data));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
