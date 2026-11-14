import { catalogListQuerySchema } from '@/shared/works';

import { listCatalogWorks } from '@/server/domains/works/catalog';
import { jsonOk, jsonSchemaError } from '@/server/infra/http/next-json';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

export const GET = withApiError(async (request: Request) => {
  const url = new URL(request.url);
  const parsed = catalogListQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error, 'query');
  }
  const data = await listCatalogWorks(parsed.data);
  return jsonOk(data);
});
