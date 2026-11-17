import { discoverySourceSettingsUpdateSchema } from '@/shared/discovery';

import { updateDiscoverySourceAdminSettings } from '@/server/domains/discovery/sync/admin';
import { jsonOk, parseJsonBody } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ sourceKey: string }> };

/** Admin: update Discover source settings (enabled, maxRows). */
export const PATCH = withApiError(async (request: Request, context: RouteContext) => {
  const identity = await getRequestIdentity(request);
  assertAdmin(identity);

  const sourceKey = pathId((await context.params).sourceKey, 'sourceKey');
  const parsed = await parseJsonBody(request, discoverySourceSettingsUpdateSchema);
  if ('response' in parsed) return parsed.response;

  return jsonOk(await updateDiscoverySourceAdminSettings(sourceKey, parsed.data));
});
