import * as assetCleanupService from '@/server/domains/assets/cleanup/service';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ jobId: string }> };

export async function GET(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    const { jobId } = await context.params;
    const job = await assetCleanupService.getCleanupJob(jobId);
    return jsonOk(job);
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
