import { lookupDictionaryQuerySchema } from '@/shared/dictionary';

import { lookupWord } from '@/server/domains/dictionary/lookup/service';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { jsonError, jsonOk, parseSearchParams } from '@/server/infra/http/next-json';
import { enforceGuestRateLimit, enforceUserRateLimit } from '@/server/infra/http/next-rate-limit';
import { getRequestIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';
import { ERROR_CODES } from '@/server/shared/errors/codes';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

export const GET = withApiError(async (request: Request) => {
  const identity = await getRequestIdentity(request);
  // Signed-in lookups still hit external providers (and optional AI
  // enrichment), so they consume a user quota instead of bypassing the guard.
  const blocked = identity.user
    ? await enforceUserRateLimit(request, 'dictionaryLookup', identity.user.id)
    : await enforceGuestRateLimit(request, 'dictionaryLookup', { isAuthenticated: false });
  if (blocked) {
    return blocked;
  }

  const url = new URL(request.url);
  const parsed = parseSearchParams(url, request, lookupDictionaryQuerySchema);
  if ('response' in parsed) return parsed.response;

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
});
