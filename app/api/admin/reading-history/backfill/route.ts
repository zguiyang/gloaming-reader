import { z } from 'zod';

import { backfillReadingDays } from '@/server/domains/reading/history/backfill';
import { jsonOk, parseJsonBody } from '@/server/infra/http/next-json';
import { assertAdmin, requireIdentity } from '@/server/infra/http/next-session';
import { createLogger } from '@/server/infra/logging/logger';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

const readingHistoryBackfillBodySchema = z
  .object({
    userId: z.string().trim().min(1).max(128),
  })
  .strict();

const readingHistoryLogger = createLogger('ReadingHistory');

export const POST = withApiError(async (request: Request) => {
  const identity = await requireIdentity(request);
  assertAdmin(identity);
  const parsed = await parseJsonBody(request, readingHistoryBackfillBodySchema);
  if ('response' in parsed) return parsed.response;
  const input = parsed.data;
  const result = await backfillReadingDays(input.userId);
  readingHistoryLogger.info(
    { operatorId: identity.user.id, targetUserId: input.userId, ...result },
    'Reading history dates backfilled',
  );
  return jsonOk({ userId: input.userId, ...result });
});
