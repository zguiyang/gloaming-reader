import { enrichPersonalWorkFromSources } from '@/server/domains/metadata';
import { rootLogger } from '@/server/infra/logging/logger';

export const JOB_SOURCE_METADATA_ENRICH = 'source-metadata-enrich';

export type SourceMetadataEnrichJobData = {
  workId: string;
};

const jobLogger = rootLogger.child({ module: 'SourceMetadataEnrichJob' });

/**
 * Best-effort OPDS metadata fill for personal uploads. Failures are logged and
 * swallowed so a miss or upstream outage never blocks readability.
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
    return { ok: true, workId, outcome: 'error' };
  }
}
