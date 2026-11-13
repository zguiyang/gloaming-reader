import { and, eq, sql } from 'drizzle-orm';

import { readingWork as readingWorkTable } from '@/server/db';

import { contentParseJobId, enqueueCoreEpubParse } from '@/server/domains/ingest/epub/work-upload';
import { db } from '@/server/infra/db';
import { rootLogger } from '@/server/infra/logging/logger';
import { hasLiveJob } from '@/server/infra/queue';

const recoveryLogger = rootLogger.child({ module: 'StalledContentParseRecovery' });

const STALLED_PARSE_SCAN_LIMIT = 20;

/**
 * A worker that dies after claiming a step leaves the Work in `processing`, and
 * BullMQ redelivers the stalled job only once: `claimWorkflowStep` then sees a
 * live lease and returns a no-op, so the redelivered job completes without
 * parsing anything. Re-enqueueing after the lease expires is the only recovery
 * path; the counter bounds a Work that crashes the worker every time.
 */
const STALLED_PARSE_MAX_RECOVERIES = 3;

type StalledWorkRow = {
  id: string;
  originKind: string | null;
  originMeta: Record<string, unknown>;
};

function persistedToken(originMeta: Record<string, unknown>): string | undefined {
  const token = originMeta.retryJobToken;
  return typeof token === 'string' && token.length > 0 ? token : undefined;
}

function recoveryAttempts(originMeta: Record<string, unknown>): number {
  const value = Number(originMeta.workflowRecoveryAttempts ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Guard matching exactly the stale claim observed by the scan, never a newer attempt. */
function staleClaimMatch(workId: string, claimAttempt: unknown, now: Date) {
  return and(
    eq(readingWorkTable.id, workId),
    eq(readingWorkTable.processingStatus, 'processing'),
    sql`coalesce(${readingWorkTable.originMeta}->>'workflowClaimAttempt', '') = ${typeof claimAttempt === 'string' ? claimAttempt : ''}`,
    sql`(${readingWorkTable.originMeta}->>'workflowClaimLeaseExpiresAt')::timestamptz <= ${now.toISOString()}`,
  );
}

async function countRecovery(row: StalledWorkRow, now: Date): Promise<void> {
  await db
    .update(readingWorkTable)
    .set({
      originMeta: sql`${readingWorkTable.originMeta} || ${JSON.stringify({
        workflowRecoveryAttempts: recoveryAttempts(row.originMeta) + 1,
      })}::jsonb`,
    })
    .where(staleClaimMatch(row.id, row.originMeta.workflowClaimAttempt, now));
}

/** Record the Work as failed instead of re-dispatching a parse that already exhausted its recoveries. */
async function failExhaustedRecovery(row: StalledWorkRow, now: Date): Promise<void> {
  await db
    .update(readingWorkTable)
    .set({
      processingStatus: 'failed',
      originMeta: sql`(${readingWorkTable.originMeta} - 'workflowClaimAttempt' - 'workflowClaimStep' - 'workflowClaimLeaseExpiresAt') || ${JSON.stringify(
        {
          failedStep: 'parse',
          lastError: `Parse stalled after ${STALLED_PARSE_MAX_RECOVERIES} recovery attempts`,
          failedAt: now.toISOString(),
        },
      )}::jsonb`,
    })
    .where(staleClaimMatch(row.id, row.originMeta.workflowClaimAttempt, now));
}

/**
 * Re-dispatch Works stuck in `processing` after their parse lease expired and
 * their queue job is gone. Runs from the worker's periodic dispatch loop and is
 * safe across worker processes: the enqueue reservation is the atomic arbiter,
 * so a losing sweep is a no-op.
 */
export async function recoverStalledContentParses(now = new Date()): Promise<number> {
  const rows = (await db
    .select({
      id: readingWorkTable.id,
      originKind: readingWorkTable.originKind,
      originMeta: readingWorkTable.originMeta,
    })
    .from(readingWorkTable)
    .where(
      and(
        eq(readingWorkTable.processingStatus, 'processing'),
        sql`coalesce(${readingWorkTable.originMeta}->>'workflowClaimStep', '') = 'parse'`,
        sql`(${readingWorkTable.originMeta}->>'workflowClaimLeaseExpiresAt')::timestamptz <= ${now.toISOString()}`,
        // The enqueue reservation outlives a lost claim by design; waiting for it
        // keeps every sweep from burning the recovery budget on a failed reservation.
        sql`coalesce(${readingWorkTable.originMeta}->>'workflowEnqueueLeaseExpiresAt', '') = '' or (${readingWorkTable.originMeta}->>'workflowEnqueueLeaseExpiresAt')::timestamptz <= ${now.toISOString()}`,
      ),
    )
    .orderBy(sql`(${readingWorkTable.originMeta}->>'workflowClaimLeaseExpiresAt')::timestamptz`)
    .limit(STALLED_PARSE_SCAN_LIMIT)) as StalledWorkRow[];

  let recovered = 0;
  for (const row of rows) {
    const retryJobToken = persistedToken(row.originMeta);
    if (!retryJobToken) {
      continue;
    }
    const lane = row.originKind === 'user_epub' ? 'default' : 'discovery';
    try {
      // Still queued (backlog, delayed retry, or live in another worker): leave it alone.
      if (await hasLiveJob(lane, contentParseJobId(row.id, retryJobToken))) {
        continue;
      }
    } catch (error) {
      recoveryLogger.warn({ err: error, workId: row.id }, 'Stalled parse queue probe failed');
      continue;
    }
    if (recoveryAttempts(row.originMeta) >= STALLED_PARSE_MAX_RECOVERIES) {
      await failExhaustedRecovery(row, now);
      recoveryLogger.error({ workId: row.id }, 'Stalled parse exhausted its recovery budget');
      continue;
    }
    try {
      await enqueueCoreEpubParse({
        workId: row.id,
        retryJobToken,
        currentStatus: 'processing',
        ...(lane === 'discovery' ? { processingLane: 'discovery' as const } : {}),
      });
    } catch (error) {
      // A lost reservation race means another sweep already re-dispatched it.
      recoveryLogger.warn({ err: error, workId: row.id }, 'Stalled parse re-dispatch failed');
      continue;
    }
    await countRecovery(row, now);
    recovered += 1;
    recoveryLogger.warn({ workId: row.id }, 'Stalled parse re-dispatched');
  }
  return recovered;
}
