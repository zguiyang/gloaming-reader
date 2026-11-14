import { libraryBrowseQuerySchema } from '@/shared/library';

import { browseLibrary } from '@/server/domains/library/service';
import { jsonOk, parseSearchParams } from '@/server/infra/http/next-json';
import { requireIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

export const GET = withApiError(async (request: Request) => {
  const identity = await requireIdentity(request);
  const url = new URL(request.url);
  const parsed = parseSearchParams(url, request, libraryBrowseQuerySchema);
  if ('response' in parsed) return parsed.response;
  const data = await browseLibrary(identity.user.id, parsed.data);
  return jsonOk(data);
});
