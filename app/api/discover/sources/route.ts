import { listEnabledDiscoverySources } from '@/server/domains/discovery/sources/service';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';

export const dynamic = 'force-dynamic';

/** Public Discover: enabled sources for the source picker. */
export async function GET(request: Request) {
  try {
    return jsonOk(await listEnabledDiscoverySources());
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
