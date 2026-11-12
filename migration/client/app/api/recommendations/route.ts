import { recommendationsQuerySchema } from '@gloaming/shared/recommendations';

import { getRecommendations } from '@/server/domains/recommendations/service';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);

    const url = new URL(request.url);
    const parsed = recommendationsQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'query',
          message: issue.message,
        })),
      );
    }

    const data = await getRecommendations(identity.user.id, parsed.data);
    return jsonOk(data);
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
