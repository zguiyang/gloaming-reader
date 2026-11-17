import { listDiscoverySourceSyncRuns } from '@/server/domains/discovery/sync/admin';
import { jsonOk } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ sourceKey: string }> };

/** Admin: bounded recent sync-run history for a Discover source. */
export const GET = withApiError(async (request: Request, context: RouteContext) => {
  const identity = await getRequestIdentity(request);
  assertAdmin(identity);

  const sourceKey = pathId((await context.params).sourceKey, 'sourceKey');
  return jsonOk(await listDiscoverySourceSyncRuns(sourceKey));
});
