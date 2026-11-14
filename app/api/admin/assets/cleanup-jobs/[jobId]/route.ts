import * as assetCleanupService from '@/server/domains/assets/cleanup/service';
import { jsonOk } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ jobId: string }> };

export const GET = withApiError(async (request: Request, context: Ctx) => {
  const identity = await getRequestIdentity(request);
  assertAdmin(identity);
  const jobId = pathId((await context.params).jobId, 'jobId');
  const job = await assetCleanupService.getCleanupJob(jobId);
  return jsonOk(job);
});
