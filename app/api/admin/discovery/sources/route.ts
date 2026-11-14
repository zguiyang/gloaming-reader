import { listAdminDiscoverySources } from '@/server/domains/discovery/sources/service';
import { jsonOk } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

/** Admin: list registered Discover sources and their enabled flags. */
export const GET = withApiError(async (request: Request) => {
  const identity = await getRequestIdentity(request);
  assertAdmin(identity);
  return jsonOk(await listAdminDiscoverySources());
});
