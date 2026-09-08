import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { readingHeartbeatBodySchema } from '@gloaming/shared/reading-history';

import { rootLogger } from '@/lib/logger';
import { sendValidationError } from '@/lib/response';
import { type AuthVariables, requireAdmin, requireAuth } from '@/middleware/auth';
import * as readingHistoryService from '@/modules/reading-history/service';

export const readingHistoryRoutes = new Hono<{ Variables: AuthVariables }>();
const readingHistoryLogger = rootLogger.child({ module: 'ReadingHistory' });

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

readingHistoryRoutes.get('/api/reading-history', requireAuth, async (c) => {
  const user = c.get('user')!;
  const data = await readingHistoryService.getReadingHistory(user.id);
  return c.json(data);
});

readingHistoryRoutes.post(
  '/api/admin/reading-history/backfill',
  requireAdmin,
  validateReadingHistoryBackfill,
  async (c) => {
    const operator = c.get('user')!;
    const input = c.req.valid('json');
    const result = await readingHistoryService.backfillReadingDays(input.userId);
    readingHistoryLogger.info(
      { operatorId: operator.id, targetUserId: input.userId, ...result },
      'Reading history dates backfilled',
    );
    return c.json({ userId: input.userId, ...result });
  },
);

readingHistoryRoutes.post('/api/reading-heartbeat', requireAuth, async (c) => {
  const user = c.get('user')!;
  const parsed = readingHeartbeatBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return sendValidationError(
      c,
      parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  const result = await readingHistoryService.recordReadingHeartbeat(user.id, parsed.data.seconds);
  return c.json(result);
});
