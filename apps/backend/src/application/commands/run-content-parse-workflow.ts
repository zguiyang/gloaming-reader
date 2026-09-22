import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import { readingPart as readingPartTable, readingWork as readingWorkTable } from '@gloaming/db';

import {
  type ContentParsePersisted,
  ParseWorkflowLeaseLostError,
  runContentParse,
  startParseWorkflowLease,
} from '@/domains/ingest/parser';
import { computePartReadingStats, computeWorkReadingStats } from '@/domains/reading';
import {
  claimWorkflowStep,
  completeWorkflowStep,
  failWorkflowStep,
  WORKFLOW_AUTO_CHAIN,
  workflowClaimWhere,
} from '@/domains/works/lifecycle';
import { db } from '@/infra/db';
import { rootLogger } from '@/infra/logging/logger';

const workflowLogger = rootLogger.child({ module: 'ContentParseWorkflow' });

async function ensureRetryJobToken(
  workId: string,
  workStatus: string,
  retryJobToken?: string,
): Promise<string | false> {
  const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId)).limit(1);
  if (!work) {
    throw new Error(`Work ${workId} not found`);
  }
  const existingToken = typeof work.originMeta.retryJobToken === 'string' ? work.originMeta.retryJobToken : undefined;
  const jobToken = retryJobToken ?? existingToken ?? randomUUID();
  if (!existingToken && !retryJobToken) {
    const [prepared] = await db
      .update(readingWorkTable)
      .set({ originMeta: sql`${readingWorkTable.originMeta} || ${JSON.stringify({ retryJobToken: jobToken })}::jsonb` })
      .where(
        and(
          eq(readingWorkTable.id, workId),
          eq(readingWorkTable.status, workStatus),
          sql`coalesce(${readingWorkTable.originMeta}->>'retryJobToken', '') = ''`,
        ),
      )
      .returning({ id: readingWorkTable.id });
    if (!prepared) {
      return false;
    }
  }
  return jobToken;
}

async function finalizeContentParseWorkflow(
  persisted: ContentParsePersisted,
  jobToken: string,
  attemptToken: string,
): Promise<boolean> {
  const workStats = computeWorkReadingStats(persisted.partBodies, persisted.parsedLanguage);
  const { workId } = persisted;

  if (WORKFLOW_AUTO_CHAIN) {
    const [updated] = await db
      .update(readingWorkTable)
      .set({
        wordCount: workStats.wordCount,
        estimatedMinutes: workStats.estimatedMinutes,
        ...(persisted.preserveManualStats
          ? {}
          : {
              suggestedVocabSize: workStats.suggestedVocabSize,
              difficultyScore: workStats.difficultyScore,
              statsProvenance: workStats.statsProvenance,
            }),
        status: 'metadata',
        originMeta: sql`${readingWorkTable.originMeta} - 'workflowParseArtifacts'`,
      })
      .where(workflowClaimWhere(workId, 'parse', jobToken, attemptToken))
      .returning({ id: readingWorkTable.id });
    if (!updated) {
      return false;
    }
  } else {
    const statsPatch = {
      wordCount: workStats.wordCount,
      estimatedMinutes: workStats.estimatedMinutes,
      ...(persisted.preserveManualStats
        ? {}
        : {
            suggestedVocabSize: workStats.suggestedVocabSize,
            difficultyScore: workStats.difficultyScore,
            statsProvenance: workStats.statsProvenance,
          }),
    };
    const [statsUpdated] = await db
      .update(readingWorkTable)
      .set(statsPatch)
      .where(workflowClaimWhere(workId, 'parse', jobToken, attemptToken))
      .returning({ id: readingWorkTable.id });
    if (!statsUpdated) {
      return false;
    }
    if (!(await completeWorkflowStep(workId, 'parsed', undefined, 'processing', jobToken, 'parse', attemptToken))) {
      return false;
    }
    await db
      .update(readingWorkTable)
      .set({
        originMeta: sql`${readingWorkTable.originMeta} - 'workflowParseArtifacts'`,
      })
      .where(eq(readingWorkTable.id, workId));
  }

  const parts = await db
    .select({ id: readingPartTable.id, body: readingPartTable.body })
    .from(readingPartTable)
    .where(eq(readingPartTable.workId, workId))
    .orderBy(readingPartTable.sortOrder);
  for (const part of parts) {
    const partStats = computePartReadingStats(part.body);
    await db
      .update(readingPartTable)
      .set({ meta: { wordCount: partStats.wordCount } })
      .where(eq(readingPartTable.id, part.id));
  }

  workflowLogger.info({ workId }, 'Content parse workflow finalized');
  return true;
}

/**
 * Claim the parse workflow step, run ingest persistence, apply reading statistics,
 * and advance workflow status (manual `parsed` or auto-chain `metadata`).
 */
export async function runContentParseWorkflow(
  workId: string,
  retryJobToken?: string,
  attemptToken = randomUUID(),
): Promise<boolean> {
  const [work] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId)).limit(1);
  if (!work) {
    throw new Error(`Work ${workId} not found`);
  }

  const jobToken = await ensureRetryJobToken(workId, work.status, retryJobToken);
  if (jobToken === false) {
    return false;
  }
  if (!(await claimWorkflowStep(workId, 'parse', jobToken, attemptToken))) {
    return false;
  }

  const [claimedWork] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, workId)).limit(1);
  if (!claimedWork) {
    throw new Error(`Work ${workId} not found`);
  }

  const lease = startParseWorkflowLease({
    workId,
    jobToken,
    attemptToken,
    logger: workflowLogger,
  });

  try {
    const persisted = await runContentParse(claimedWork, jobToken, attemptToken, lease);
    if (persisted === false) {
      return false;
    }
    if (!(await finalizeContentParseWorkflow(persisted, jobToken, attemptToken))) {
      return false;
    }
    return true;
  } catch (error) {
    if (error instanceof ParseWorkflowLeaseLostError || lease.isLeaseLost()) {
      return false;
    }
    await failWorkflowStep(workId, 'parse', jobToken, attemptToken, error);
    throw error;
  } finally {
    lease.stopHeartbeat();
  }
}
