import type { readingWork as readingWorkTable } from '@gloaming/db';
import type { WorkflowStep } from '@gloaming/shared/works';
import { WORKFLOW_STEPS } from '@gloaming/shared/works';

type WorkRow = typeof readingWorkTable.$inferSelect;

/** The step that failed (originMeta.failedStep), validated against the enum. */
export function failedStepOf(row: WorkRow): WorkflowStep | null {
  const value = row.originMeta?.failedStep;
  return typeof value === 'string' && (WORKFLOW_STEPS as readonly string[]).includes(value)
    ? (value as WorkflowStep)
    : null;
}
