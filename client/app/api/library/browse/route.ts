import { libraryBrowseQuerySchema } from '@/shared/library';

import { browseLibrary } from '@/server/domains/library/service';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const url = new URL(request.url);
    const parsed = libraryBrowseQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'query',
          message: issue.message,
        })),
      );
    }
    const data = await browseLibrary(identity.user.id, parsed.data);
    return jsonOk(data);
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
