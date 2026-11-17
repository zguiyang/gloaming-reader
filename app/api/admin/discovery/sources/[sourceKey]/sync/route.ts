import { z } from 'zod';

import { triggerDiscoverySourceSync } from '@/server/domains/discovery/sync/admin';
import { jsonOk, parseJsonBody } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';
import { HTTP_STATUS } from '@/server/shared/constants';

export const dynamic = 'force-dynamic';

const discoverySyncTriggerBodySchema = z.preprocess(
  (value) => (value === null || value === undefined ? {} : value),
  z.object({
    force: z.boolean().optional(),
  }),
);

type RouteContext = { params: Promise<{ sourceKey: string }> };

/** Admin: enqueue a bounded catalog sync for the given source. */
export const POST = withApiError(async (request: Request, context: RouteContext) => {
  const identity = await getRequestIdentity(request);
  assertAdmin(identity);

  const sourceKey = pathId((await context.params).sourceKey, 'sourceKey');
  const parsed = await parseJsonBody(request, discoverySyncTriggerBodySchema);
  if ('response' in parsed) return parsed.response;

  const accepted = await triggerDiscoverySourceSync(sourceKey, { force: parsed.data.force });
  const status = accepted.result === 'queued' ? HTTP_STATUS.ACCEPTED : HTTP_STATUS.OK;
  return jsonOk(accepted, { status });
});
