import type { ScenarioResult } from './types';

export function scenarioCNotRun(): ScenarioResult {
  return {
    id: 'C',
    name: 'Partial delete failure + retry',
    status: 'NOT RUN',
    observations: [],
    evidence: [
      'Unit coverage: apps/backend/tests/unit/cleanup-job.spec.ts (partial on delete failures, retryable status)',
      'Functional coverage uses MemoryObjectStore failure injection, not live R2',
    ],
    notRunReason:
      'Live R2/S3 has no safe, controllable delete-failure injection without mutating production code or IAM. Not forged.',
  };
}

export function scenarioDNotRun(): ScenarioResult {
  return {
    id: 'D',
    name: 'Dual-worker lock fencing',
    status: 'NOT RUN',
    observations: [],
    evidence: [
      'Unit coverage: apps/backend/tests/unit/cleanup-job.spec.ts (stale worker / lock ownership lost)',
      'Unit coverage: apps/backend/tests/unit/cleanup-store.spec.ts (owned save script)',
    ],
    notRunReason:
      'Safe dual-Worker orchestration against shared lock timing is not available without invasive hooks; not claimed as real dual-Worker PASS.',
  };
}
