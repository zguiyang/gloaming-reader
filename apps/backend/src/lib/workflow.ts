import { and, eq, or, sql } from 'drizzle-orm';

import { readingWork as readingWorkTable } from '@gloaming/db';
import type { WorkflowStep, WorkStatus } from '@gloaming/shared/works';

import { db } from '@/db';

const STEP_RUNNING_STATUS: Record<WorkflowStep, WorkStatus> = {
  parse: 'processing',
  metadata: 'metadata',
  tts: 'tts',
};

const WORKFLOW_LEASE_MS = 15 * 60 * 1000;

/** Idle wait statuses that may still claim the next step (manual pipeline). */
const STEP_IDLE_CLAIM_STATUS: Partial<Record<WorkflowStep, WorkStatus>> = {
  parse: 'uploaded',
  metadata: 'parsed',
};

export function stepRunningStatus(step: WorkflowStep): WorkStatus {
  return STEP_RUNNING_STATUS[step];
}

function workflowTokenMatch(retryJobToken: string) {
  return sql`${readingWorkTable.originMeta}->>'retryJobToken' = ${retryJobToken}`;
}

function workflowClaimMatch(attemptToken: string, step: WorkflowStep) {
  return and(
    sql`${readingWorkTable.originMeta}->>'workflowClaimAttempt' = ${attemptToken}`,
    sql`${readingWorkTable.originMeta}->>'workflowClaimStep' = ${step}`,
    sql`(${readingWorkTable.originMeta}->>'workflowClaimLeaseExpiresAt')::timestamptz > now()`,
  );
}

function claimIsAvailable(step: WorkflowStep) {
  return or(
    sql`coalesce(${readingWorkTable.originMeta}->>'workflowClaimAttempt', '') = ''`,
    and(
      sql`${readingWorkTable.originMeta}->>'workflowClaimStep' = ${step}`,
      sql`(${readingWorkTable.originMeta}->>'workflowClaimLeaseExpiresAt')::timestamptz <= now()`,
    )!,
  );
}

function enqueueLeaseIsAvailable() {
  return or(
    sql`coalesce(${readingWorkTable.originMeta}->>'workflowEnqueueAttempt', '') = ''`,
    sql`(${readingWorkTable.originMeta}->>'workflowEnqueueLeaseExpiresAt')::timestamptz <= now()`,
  );
}

export function workflowLeaseExpiresAt(): string {
  return new Date(Date.now() + WORKFLOW_LEASE_MS).toISOString();
}

/** Conditional ownership predicate for a worker that has already claimed a step. */
export function workflowClaimWhere(workId: string, step: WorkflowStep, retryJobToken: string, attemptToken: string) {
  return and(
    eq(readingWorkTable.id, workId),
    eq(readingWorkTable.status, STEP_RUNNING_STATUS[step]),
    workflowTokenMatch(retryJobToken),
    workflowClaimMatch(attemptToken, step),
  );
}

/**
 * Claim the workflow step before running its job. BullMQ delivery retries that
 * arrive while the lease is active are deliberately no-ops; expired claims
 * are recovered through the explicit admin retry path.
 */
export async function claimWorkflowStep(
  workId: string,
  step: WorkflowStep,
  retryJobToken: string,
  attemptToken: string,
): Promise<boolean> {
  if (!retryJobToken || !attemptToken) {
    return false;
  }
  const running = STEP_RUNNING_STATUS[step];
  const idle = STEP_IDLE_CLAIM_STATUS[step];
  const available = claimIsAvailable(step);
  const eligible = [and(eq(readingWorkTable.status, running), workflowTokenMatch(retryJobToken), available)!];
  if (idle) {
    eligible.push(and(eq(readingWorkTable.status, idle), workflowTokenMatch(retryJobToken), available)!);
  }
  eligible.push(
    and(
      eq(readingWorkTable.status, 'failed'),
      sql`${readingWorkTable.originMeta}->>'failedStep' = ${step}`,
      workflowTokenMatch(retryJobToken),
      available,
    )!,
  );

  const [claimed] = await db
    .update(readingWorkTable)
    .set({
      status: running,
      originMeta: sql`(${readingWorkTable.originMeta} - 'failedStep' - 'lastError' - 'failedAt' - 'workflowClaimAttempt' - 'workflowClaimStep' - 'workflowClaimLeaseExpiresAt' - 'workflowEnqueueAttempt' - 'workflowEnqueueLeaseExpiresAt') || ${JSON.stringify(
        {
          workflowClaimAttempt: attemptToken,
          workflowClaimStep: step,
          workflowClaimLeaseExpiresAt: workflowLeaseExpiresAt(),
        },
      )}::jsonb`,
    })
    .where(and(eq(readingWorkTable.id, workId), or(...eligible)))
    .returning({ id: readingWorkTable.id });
  return Boolean(claimed);
}

/** Extend a live worker lease without changing its attempt identity. */
export async function renewWorkflowClaim(
  workId: string,
  step: WorkflowStep,
  retryJobToken: string,
  attemptToken: string,
): Promise<boolean> {
  const [renewed] = await db
    .update(readingWorkTable)
    .set({
      originMeta: sql`jsonb_set(${readingWorkTable.originMeta}, '{workflowClaimLeaseExpiresAt}', to_jsonb(${workflowLeaseExpiresAt()}::text), true)`,
    })
    .where(workflowClaimWhere(workId, step, retryJobToken, attemptToken))
    .returning({ id: readingWorkTable.id });
  return Boolean(renewed);
}

/** Record a step failure: status → failed + failedStep/lastError/failedAt. */
export async function failWorkflowStep(
  workId: string,
  step: WorkflowStep,
  retryJobToken: string,
  attemptToken: string,
  error: unknown,
): Promise<boolean> {
  const message = error instanceof Error ? error.message : String(error);
  const failedAt = new Date().toISOString();
  const [failed] = await db
    .update(readingWorkTable)
    .set({
      status: 'failed',
      originMeta: sql`(${readingWorkTable.originMeta} - 'metadataAt' - 'metadataEnrichGaps' - 'metadataEnrichError' - 'workflowClaimAttempt' - 'workflowClaimStep' - 'workflowClaimLeaseExpiresAt' - 'workflowEnqueueStep' - 'workflowEnqueueAttempt' - 'workflowEnqueueLeaseExpiresAt') || ${JSON.stringify({ failedStep: step, lastError: message, failedAt })}::jsonb`,
    })
    .where(workflowClaimWhere(workId, step, retryJobToken, attemptToken))
    .returning({ id: readingWorkTable.id });
  return Boolean(failed);
}

/** Convert a post-claim enqueue failure into a retryable workflow failure. */
export async function failWorkflowEnqueue(
  workId: string,
  step: WorkflowStep,
  retryJobToken: string,
  currentStatus: WorkStatus,
  attemptToken: string,
  error: unknown,
): Promise<boolean> {
  const message = error instanceof Error ? error.message : String(error);
  const failedAt = new Date().toISOString();
  const [failed] = await db
    .update(readingWorkTable)
    .set({
      status: 'failed',
      originMeta: sql`(${readingWorkTable.originMeta} - 'metadataAt' - 'metadataEnrichGaps' - 'metadataEnrichError' - 'workflowClaimAttempt' - 'workflowClaimStep' - 'workflowClaimLeaseExpiresAt' - 'workflowEnqueueStep' - 'workflowEnqueueAttempt' - 'workflowEnqueueLeaseExpiresAt') || ${JSON.stringify({ failedStep: step, lastError: message, failedAt })}::jsonb`,
    })
    .where(
      and(
        eq(readingWorkTable.id, workId),
        eq(readingWorkTable.status, currentStatus),
        workflowTokenMatch(retryJobToken),
        sql`${readingWorkTable.originMeta}->>'workflowEnqueueStep' = ${step}`,
        sql`${readingWorkTable.originMeta}->>'workflowEnqueueAttempt' = ${attemptToken}`,
        sql`(${readingWorkTable.originMeta}->>'workflowEnqueueLeaseExpiresAt')::timestamptz > now()`,
      ),
    )
    .returning({ id: readingWorkTable.id });
  return Boolean(failed);
}

/** Complete the step: move to the next status and clear failure residue. */
export async function completeWorkflowStep(
  workId: string,
  nextStatus: WorkStatus,
  metaPatch?: Record<string, unknown>,
  expectedStatus?: WorkStatus | WorkStatus[],
  retryJobToken?: string,
  claimStep?: WorkflowStep,
  attemptToken?: string,
): Promise<boolean> {
  const statuses = expectedStatus
    ? Array.isArray(expectedStatus)
      ? expectedStatus
      : [expectedStatus]
    : ['processing', 'metadata', 'tts' as const];
  const patch = JSON.stringify(metaPatch ?? {});
  const [completed] = await db
    .update(readingWorkTable)
    .set({
      status: nextStatus,
      originMeta: sql`(${readingWorkTable.originMeta} - 'failedStep' - 'lastError' - 'failedAt' - 'workflowClaimAttempt' - 'workflowClaimStep' - 'workflowClaimLeaseExpiresAt' - 'workflowEnqueueAttempt' - 'workflowEnqueueLeaseExpiresAt') || ${patch}::jsonb`,
    })
    .where(
      retryJobToken && claimStep && attemptToken
        ? and(
            eq(readingWorkTable.id, workId),
            or(...statuses.map((status) => eq(readingWorkTable.status, status))),
            workflowTokenMatch(retryJobToken),
            workflowClaimMatch(attemptToken, claimStep),
          )
        : and(eq(readingWorkTable.id, workId), or(...statuses.map((status) => eq(readingWorkTable.status, status)))),
    )
    .returning({ id: readingWorkTable.id });
  return Boolean(completed);
}

/** Rotate the execution identity between sequential jobs in one workflow step. */
export async function rotateWorkflowJobToken(
  workId: string,
  claimStep: WorkflowStep,
  currentStatus: WorkStatus,
  currentToken: string,
  currentAttemptToken: string,
  nextToken: string,
  nextAttemptToken: string,
  nextEnqueueStep: WorkflowStep,
  nextStatus: WorkStatus,
): Promise<boolean> {
  const [rotated] = await db
    .update(readingWorkTable)
    .set({
      status: nextStatus,
      originMeta: sql`(${readingWorkTable.originMeta} - 'workflowClaimAttempt' - 'workflowClaimStep' - 'workflowClaimLeaseExpiresAt' - 'workflowEnqueueAttempt' - 'workflowEnqueueLeaseExpiresAt') || ${JSON.stringify(
        {
          retryJobToken: nextToken,
          workflowEnqueueStep: nextEnqueueStep,
          workflowEnqueueAttempt: nextAttemptToken,
          workflowEnqueueLeaseExpiresAt: workflowLeaseExpiresAt(),
        },
      )}::jsonb`,
    })
    .where(
      and(
        eq(readingWorkTable.id, workId),
        eq(readingWorkTable.status, currentStatus),
        workflowTokenMatch(currentToken),
        workflowClaimMatch(currentAttemptToken, claimStep),
      ),
    )
    .returning({ id: readingWorkTable.id });
  return Boolean(rotated);
}

/** Reserve the enqueue transition before a newly-created workflow is queued. */
export async function prepareWorkflowEnqueue(
  workId: string,
  step: WorkflowStep,
  currentStatus: WorkStatus,
  retryJobToken: string,
  enqueueAttemptToken: string,
): Promise<boolean> {
  const [prepared] = await db
    .update(readingWorkTable)
    .set({
      originMeta: sql`${readingWorkTable.originMeta} || ${JSON.stringify({
        workflowEnqueueStep: step,
        workflowEnqueueAttempt: enqueueAttemptToken,
        workflowEnqueueLeaseExpiresAt: workflowLeaseExpiresAt(),
      })}::jsonb`,
    })
    .where(
      and(
        eq(readingWorkTable.id, workId),
        eq(readingWorkTable.status, currentStatus),
        workflowTokenMatch(retryJobToken),
        enqueueLeaseIsAvailable(),
      ),
    )
    .returning({ id: readingWorkTable.id });
  return Boolean(prepared);
}
