import { assetCleanupRequestSchema } from '@/shared/assets';

import * as assetCleanupService from '@/server/domains/assets/cleanup/service';
import { jsonOk, parseJsonBody } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ scanId: string }> };

export const POST = withApiError(async (request: Request, context: Ctx) => {
  const identity = await getRequestIdentity(request);
  assertAdmin(identity);
  const scanId = pathId((await context.params).scanId, 'scanId');
  const parsed = await parseJsonBody(request, assetCleanupRequestSchema);
  if ('response' in parsed) return parsed.response;
  const result = await assetCleanupService.enqueueOrphanCleanup(scanId);
  return jsonOk(result, { status: HTTP_STATUS.ACCEPTED });
});
