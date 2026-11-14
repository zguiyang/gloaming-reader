import { discoverySourceEnabledUpdateSchema } from '@/shared/discovery';

import { setDiscoverySourceEnabled } from '@/server/domains/discovery/sources/service';
import { jsonOk, parseJsonBody } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ sourceKey: string }> };

/** Admin: enable or disable a registered Discover source. */
export const PATCH = withApiError(async (request: Request, context: RouteContext) => {
  const identity = await getRequestIdentity(request);
  assertAdmin(identity);

  const sourceKey = pathId((await context.params).sourceKey, 'sourceKey');
  const parsed = await parseJsonBody(request, discoverySourceEnabledUpdateSchema);
  if ('response' in parsed) return parsed.response;

  return jsonOk(await setDiscoverySourceEnabled(sourceKey, parsed.data.enabled));
});
