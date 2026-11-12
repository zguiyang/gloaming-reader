import { lookupDictionaryQuerySchema } from '@gloaming/shared/dictionary';

import { lookupWord } from '@/server/domains/dictionary/lookup/service';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { jsonError, jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { enforceGuestRateLimit } from '@/server/infra/http/next-rate-limit';
import { getRequestIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';
import { ERROR_CODES } from '@/server/shared/errors/codes';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    const guestBlocked = await enforceGuestRateLimit(request, 'dictionaryLookup', {
      isAuthenticated: Boolean(identity.user),
    });
    if (guestBlocked) {
      return guestBlocked;
    }

    const url = new URL(request.url);
    const parsed = lookupDictionaryQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'query',
          message: issue.message,
        })),
      );
    }

    const query = parsed.data;
    const entry = await lookupWord({
      actor: workReadActorFromIdentity(identity.user),
      word: query.word,
      contextSentence: query.contextSentence,
      workId: query.workId,
      partId: query.partId,
    });

    if (!entry) {
      return jsonError(request, ERROR_CODES.NOT_FOUND.WORD_DEFINITION, HTTP_STATUS.NOT_FOUND, { word: query.word });
    }

    return jsonOk({ ok: true, entry });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
