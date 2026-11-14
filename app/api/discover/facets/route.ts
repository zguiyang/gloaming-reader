import { discoveryFacetListQuerySchema } from '@/shared/discovery';

import { listDiscoveryFacets } from '@/server/domains/discovery/read-model';
import { jsonOk, parseSearchParams } from '@/server/infra/http/next-json';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

export const GET = withApiError(async (request: Request) => {
  const url = new URL(request.url);
  const parsed = parseSearchParams(url, request, discoveryFacetListQuerySchema);
  if ('response' in parsed) return parsed.response;
  const data = await listDiscoveryFacets(parsed.data.sourceKey);
  return jsonOk(data);
});
