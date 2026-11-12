import { z } from 'zod';

import { requestProjectGutenbergSync } from '@/server/domains/discovery/sync/admin';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';

export const dynamic = 'force-dynamic';

const discoverySyncTriggerSchema = z.object({
  force: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    const raw = await request.json().catch(() => ({}));
    const parsed = discoverySyncTriggerSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }
    const { force } = parsed.data;
    const accepted = await requestProjectGutenbergSync({ force });
    return jsonOk(accepted, { status: accepted.result === 'queued' ? HTTP_STATUS.ACCEPTED : HTTP_STATUS.OK });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
