import { assetCleanupRequestSchema } from '@/shared/assets';

import * as assetCleanupService from '@/server/domains/assets/cleanup/service';
import { jsonOk, jsonSchemaError } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ jobId: string }> };

export const POST = withApiError(async (request: Request, context: Ctx) => {
  const identity = await getRequestIdentity(request);
  assertAdmin(identity);
  const jobId = pathId((await context.params).jobId, 'jobId');
  const raw = await request.json().catch(() => null);
  const parsed = assetCleanupRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error);
  }
  const result = await assetCleanupService.retryCleanupJob(jobId);
  return jsonOk(result, { status: HTTP_STATUS.ACCEPTED });
});
