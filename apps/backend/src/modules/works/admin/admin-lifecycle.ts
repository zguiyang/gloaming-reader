import { randomUUID } from 'node:crypto';

import { and, eq, or, sql } from 'drizzle-orm';

import { readingWork as readingWorkTable } from '@gloaming/db';
import type { AdminWork, RetryWorkflowBody, WorkflowStep } from '@gloaming/shared/works';

import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { JOB_CONTENT_PARSE } from '@/jobs/content-parse';
import { JOB_METADATA_FILL } from '@/jobs/work-metadata-fill';
import { AppError, NotFoundError, ValidationFailedError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';
import { enqueue } from '@/lib/queue';
import { failWorkflowEnqueue, stepRunningStatus, workflowLeaseExpiresAt } from '@/lib/workflow';
import { TTS_STEP_ENABLED } from '@/lib/workflow-policy';
import { buildPublishIssuesForWork } from '@/modules/works/admin/admin-publish-gate';
import { getAdminWork } from '@/modules/works/admin/admin-work-read';
import { loadPartsForWork, loadSourcesForWork, loadTagsForWork } from '@/modules/works/read-model/relations';
import { failedStepOf } from '@/modules/works/workflow-meta';

type WorkRow = typeof readingWorkTable.$inferSelect;

const STEP_JOB: Record<Exclude<WorkflowStep, 'tts'>, string> = {
  parse: JOB_CONTENT_PARSE,
  metadata: JOB_METADATA_FILL,
};

function hasExpiredWorkflowClaim(row: WorkRow, step: WorkflowStep): boolean {
  const meta = row.originMeta as Record<string, unknown>;
  const lease = meta.workflowClaimLeaseExpiresAt;
  return (
    meta.workflowClaimStep === step &&
    typeof meta.workflowClaimAttempt === 'string' &&
    meta.workflowClaimAttempt.length > 0 &&
    typeof lease === 'string' &&
    Number.isFinite(Date.parse(lease)) &&
    Date.parse(lease) <= Date.now()
  );
}

function hasExpiredWorkflowEnqueue(row: WorkRow, step: WorkflowStep): boolean {
  const meta = row.originMeta as Record<string, unknown>;
  const lease = meta.workflowEnqueueLeaseExpiresAt;
  return (
    meta.workflowEnqueueStep === step &&
    typeof meta.workflowEnqueueAttempt === 'string' &&
    meta.workflowEnqueueAttempt.length > 0 &&
    typeof lease === 'string' &&
    Number.isFinite(Date.parse(lease)) &&
    Date.parse(lease) <= Date.now()
  );
}

function workflowRetryLeaseRecoveryWhere(step: WorkflowStep) {
  return or(
    and(
      sql`${readingWorkTable.originMeta}->>'workflowClaimStep' = ${step}`,
      sql`(${readingWorkTable.originMeta}->>'workflowClaimLeaseExpiresAt')::timestamptz <= now()`,
    ),
    and(
      sql`${readingWorkTable.originMeta}->>'workflowEnqueueStep' = ${step}`,
      sql`(${readingWorkTable.originMeta}->>'workflowEnqueueLeaseExpiresAt')::timestamptz <= now()`,
    ),
  );
}

async function loadAdminWorkAfterMutation(id: string): Promise<AdminWork> {
  return getAdminWork(id);
}

export async function publishWork(id: string): Promise<AdminWork> {
  const [existing] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, id)).limit(1);
  if (!existing) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
  }
  if (existing.status !== 'ready') {
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.WORK.PUBLISH_INCOMPLETE);
  }

  const parts = await loadPartsForWork(id);
  const tags = await loadTagsForWork(id);
  const sources = await loadSourcesForWork(id);
  const issues = await buildPublishIssuesForWork(existing, parts, tags, sources);
  if (issues.length > 0) {
    throw new ValidationFailedError(issues);
  }

  const [row] = await db
    .update(readingWorkTable)
    .set({ status: 'published', publishedAt: new Date() })
    .where(eq(readingWorkTable.id, id))
    .returning();

  if (!row) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
  }
  return loadAdminWorkAfterMutation(id);
}

export async function unpublishWork(id: string): Promise<AdminWork> {
  const [existing] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, id)).limit(1);
  if (!existing) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
  }
  if (existing.status !== 'published') {
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.WORK.UNPUBLISH_NOT_PUBLISHED);
  }

  const [row] = await db
    .update(readingWorkTable)
    .set({ status: 'ready', publishedAt: null })
    .where(eq(readingWorkTable.id, id))
    .returning();

  if (!row) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
  }
  return loadAdminWorkAfterMutation(id);
}

/**
 * Workflow retry / re-run / manual next-step. Without `step` it resumes from
 * the failed step (originMeta.failedStep); with `step` it re-runs that step.
 * Sets the running status and enqueues the job immediately — output reset runs
 * inside the job so the admin click returns quickly. Refused while a step is
 * actively running or while published.
 */
export async function retryWorkflow(id: string, input: RetryWorkflowBody = {}): Promise<AdminWork> {
  const [existing] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, id)).limit(1);
  if (!existing) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.WORK);
  }
  if (existing.originKind !== 'admin_epub') {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.WORK.RETRY_EPUB_ONLY);
  }
  if (existing.status === 'published') {
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.WORK.UNPUBLISH_BEFORE_RETRY);
  }
  const step = input.step ?? failedStepOf(existing);
  const retryJobToken = randomUUID();
  if (!step) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.WORK.NO_RETRYABLE_STEPS);
  }
  const running = existing.status === 'processing' || existing.status === 'metadata' || existing.status === 'tts';
  const expiredClaim = hasExpiredWorkflowClaim(existing, step);
  const expiredEnqueue = hasExpiredWorkflowEnqueue(existing, step);
  if (running && !expiredClaim && !expiredEnqueue) {
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.WORK.PROCESSING_IN_PROGRESS);
  }
  const retryAttemptToken = randomUUID();
  if (step === 'tts') {
    if (!TTS_STEP_ENABLED) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.WORK.MANUAL_AUDIO_REQUIRED);
    }
    const [claimed] = await db
      .update(readingWorkTable)
      .set({
        status: stepRunningStatus(step),
        originMeta: {
          ...existing.originMeta,
          failedStep: undefined,
          lastError: undefined,
          failedAt: undefined,
          retryJobToken,
          workflowClaimAttempt: undefined,
          workflowClaimStep: undefined,
          workflowClaimLeaseExpiresAt: undefined,
          workflowEnqueueStep: 'tts',
          workflowEnqueueAttempt: retryAttemptToken,
          workflowEnqueueLeaseExpiresAt: workflowLeaseExpiresAt(),
        },
      })
      .where(
        and(
          eq(readingWorkTable.id, id),
          eq(readingWorkTable.status, existing.status),
          running ? workflowRetryLeaseRecoveryWhere(step) : sql`true`,
        ),
      )
      .returning({ id: readingWorkTable.id });
    if (!claimed) {
      throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.WORK.STATE_CHANGED);
    }
    const { enqueueWorkAudio } = await import('@/modules/content-assets/audio/generation');
    try {
      await enqueueWorkAudio(id, { force: false, roles: ['us', 'uk'] });
    } catch (error) {
      await failWorkflowEnqueue(id, 'tts', retryJobToken, 'tts', retryAttemptToken, error);
      throw error;
    }
    return loadAdminWorkAfterMutation(id);
  }

  const [claimed] = await db
    .update(readingWorkTable)
    .set({
      status: stepRunningStatus(step),
      originMeta: {
        ...existing.originMeta,
        failedStep: undefined,
        lastError: undefined,
        failedAt: undefined,
        retryJobToken,
        workflowClaimAttempt: undefined,
        workflowClaimStep: undefined,
        workflowClaimLeaseExpiresAt: undefined,
        workflowEnqueueStep: step,
        workflowEnqueueAttempt: retryAttemptToken,
        workflowEnqueueLeaseExpiresAt: workflowLeaseExpiresAt(),
        ...(step === 'metadata'
          ? { metadataAt: undefined, metadataEnrichGaps: undefined, metadataEnrichError: undefined }
          : {}),
        ...(step === 'parse' ? { parsed: undefined, metadataAt: undefined, metadataEnrichGaps: undefined } : {}),
      },
    })
    .where(
      and(
        eq(readingWorkTable.id, id),
        eq(readingWorkTable.status, existing.status),
        running ? workflowRetryLeaseRecoveryWhere(step) : sql`true`,
      ),
    )
    .returning({ id: readingWorkTable.id });
  if (!claimed) {
    throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.WORK.STATE_CHANGED);
  }

  try {
    await enqueue(
      STEP_JOB[step],
      { workId: id, retryJobToken },
      { attempts: 2, jobId: `${STEP_JOB[step]}:${id}:${retryJobToken}` },
    );
  } catch (error) {
    await failWorkflowEnqueue(id, step, retryJobToken, stepRunningStatus(step), retryAttemptToken, error);
    throw error;
  }
  return loadAdminWorkAfterMutation(id);
}
