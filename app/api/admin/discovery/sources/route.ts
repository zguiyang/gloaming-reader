import { listAdminDiscoverySources } from '@/server/domains/discovery/sources/service';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

/** Admin: list registered Discover sources and their enabled flags. */
export async function GET(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    return jsonOk(await listAdminDiscoverySources());
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
