import { listEnabledDiscoverySources } from '@/server/domains/discovery/sources/service';
import { jsonOk } from '@/server/infra/http/next-json';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

/** Public Discover: enabled sources for the source picker. */
export const GET = withApiError(async (_request: Request) => {
  return jsonOk(await listEnabledDiscoverySources());
});
