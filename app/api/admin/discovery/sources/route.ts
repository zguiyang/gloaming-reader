import { listAdminDiscoverySourceStatuses } from '@/server/domains/discovery/sync/admin';
import { jsonOk } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

/** Admin: list registered Discover sources, sync settings, and index status. */
export const GET = withApiError(async (request: Request) => {
  const identity = await getRequestIdentity(request);
  assertAdmin(identity);
  return jsonOk(await listAdminDiscoverySourceStatuses());
});
