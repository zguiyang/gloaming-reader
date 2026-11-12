import { z } from 'zod';

import { backfillReadingDays } from '@/server/domains/reading/history/backfill';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAdmin, assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';
import { rootLogger } from '@/server/infra/logging/logger';

export const dynamic = 'force-dynamic';

const readingHistoryBackfillBodySchema = z
  .object({
    userId: z.string().trim().min(1).max(128),
  })
  .strict();

const readingHistoryLogger = rootLogger.child({ module: 'ReadingHistory' });

export async function POST(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    assertAdmin(identity);
    const raw = await request.json().catch(() => null);
    const parsed = readingHistoryBackfillBodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }
    const input = parsed.data;
    const result = await backfillReadingDays(input.userId);
    readingHistoryLogger.info(
      { operatorId: identity.user.id, targetUserId: input.userId, ...result },
      'Reading history dates backfilled',
    );
    return jsonOk({ userId: input.userId, ...result });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
