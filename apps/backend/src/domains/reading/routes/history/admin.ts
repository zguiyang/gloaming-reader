import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { backfillReadingDays } from '@/domains/reading/history/backfill';
import { type AuthVariables, requireAdmin } from '@/infra/http/middleware/auth';
import { sendValidationError } from '@/infra/http/response';
import { rootLogger } from '@/infra/logging/logger';

export const readingHistoryAdminRoutes = new Hono<{ Variables: AuthVariables }>();

const readingHistoryBackfillBodySchema = z
  .object({
    userId: z.string().trim().min(1).max(128),
  })
  .strict();

const validateReadingHistoryBackfill = zValidator('json', readingHistoryBackfillBodySchema, (result, c) => {
  if (!result.success) {
    return sendValidationError(
      c,
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
});

const readingHistoryLogger = rootLogger.child({ module: 'ReadingHistory' });

readingHistoryAdminRoutes.post(
  '/api/admin/reading-history/backfill',
  requireAdmin,
  validateReadingHistoryBackfill,
  async (c) => {
    const operator = c.get('user')!;
    const input = c.req.valid('json');
    const result = await backfillReadingDays(input.userId);
    readingHistoryLogger.info(
      { operatorId: operator.id, targetUserId: input.userId, ...result },
      'Reading history dates backfilled',
    );
    return c.json({ userId: input.userId, ...result });
  },
);
