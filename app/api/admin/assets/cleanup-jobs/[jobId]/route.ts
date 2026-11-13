import * as assetCleanupService from '@/server/domains/assets/cleanup/service';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';
import { pathId } from '@/server/infra/http/path-params';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ jobId: string }> };

export async function GET(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    const jobId = pathId((await context.params).jobId, 'jobId');
    const job = await assetCleanupService.getCleanupJob(jobId);
    return jsonOk(job);
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
