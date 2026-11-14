import { catalogListQuerySchema } from '@/shared/works';

import { listCatalogWorks } from '@/server/domains/works/catalog';
import { jsonOk, parseSearchParams } from '@/server/infra/http/next-json';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

export const GET = withApiError(async (request: Request) => {
  const url = new URL(request.url);
  const parsed = parseSearchParams(url, request, catalogListQuerySchema);
  if ('response' in parsed) return parsed.response;
  const data = await listCatalogWorks(parsed.data);
  return jsonOk(data);
});
