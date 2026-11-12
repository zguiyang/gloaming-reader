import { assetCleanupRequestSchema } from '@gloaming/shared/assets';

import * as assetCleanupService from '@/server/domains/assets/cleanup/service';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ jobId: string }> };

export async function POST(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    const { jobId } = await context.params;
    const raw = await request.json().catch(() => null);
    const parsed = assetCleanupRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }
    const result = await assetCleanupService.retryCleanupJob(jobId);
    return jsonOk(result, { status: HTTP_STATUS.ACCEPTED });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
