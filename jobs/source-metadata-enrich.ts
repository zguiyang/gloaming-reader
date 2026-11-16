import { enrichPersonalWorkFromSources } from '@/server/domains/metadata';
import { createLogger } from '@/server/infra/logging/logger';

export const JOB_SOURCE_METADATA_ENRICH = 'source-metadata-enrich';

export type SourceMetadataEnrichJobData = {
  workId: string;
};

const jobLogger = createLogger('SourceMetadataEnrichJob');

/**
 * Best-effort OPDS metadata fill for personal uploads. Readability never depends
 * on this job: every expected miss is reported as a normal outcome, and only an
 * unexpected error is rethrown so the queue's `attempts` budget retries it and
 * the failure stays visible instead of being recorded as a silent success.
 */
export async function processSourceMetadataEnrich(
  data: SourceMetadataEnrichJobData,
): Promise<{ ok: true; workId: string; outcome: string }> {
  const workId = typeof data?.workId === 'string' ? data.workId : '';
  if (!workId) {
    return { ok: true, workId: '', outcome: 'skipped' };
  }
  try {
    const result = await enrichPersonalWorkFromSources(workId);
    const outcome = result.outcome === 'enriched' ? 'enriched' : result.outcome === 'missed' ? 'missed' : result.reason;
    return { ok: true, workId, outcome };
  } catch (error) {
    jobLogger.warn({ err: error, workId }, 'Source metadata enrich failed');
    throw error;
  }
}
