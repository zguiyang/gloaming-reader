import { discoveryFacetListQuerySchema } from '@/shared/discovery';

import { listDiscoveryFacets } from '@/server/domains/discovery/read-model';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = discoveryFacetListQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'query',
          message: issue.message,
        })),
      );
    }
    const data = await listDiscoveryFacets(parsed.data.sourceKey);
    return jsonOk(data);
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
