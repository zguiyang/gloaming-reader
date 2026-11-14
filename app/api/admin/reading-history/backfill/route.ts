import { z } from 'zod';

import { backfillReadingDays } from '@/server/domains/reading/history/backfill';
import { jsonOk, jsonSchemaError } from '@/server/infra/http/next-json';
import { assertAdmin, requireIdentity } from '@/server/infra/http/next-session';
import { rootLogger } from '@/server/infra/logging/logger';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

const readingHistoryBackfillBodySchema = z
  .object({
    userId: z.string().trim().min(1).max(128),
  })
  .strict();

const readingHistoryLogger = rootLogger.child({ module: 'ReadingHistory' });

export const POST = withApiError(async (request: Request) => {
  const identity = await requireIdentity(request);
  assertAdmin(identity);
  const raw = await request.json().catch(() => null);
  const parsed = readingHistoryBackfillBodySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonSchemaError(request, parsed.error);
  }
  const input = parsed.data;
  const result = await backfillReadingDays(input.userId);
  readingHistoryLogger.info(
    { operatorId: identity.user.id, targetUserId: input.userId, ...result },
    'Reading history dates backfilled',
  );
  return jsonOk({ userId: input.userId, ...result });
});
