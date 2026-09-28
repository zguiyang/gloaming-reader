import type { SourceReference, TaxonomyReference } from '@gloaming/shared/taxonomy';
import {
  type AdminOriginAsset,
  type AdminWork,
  type AdminWorkListQuery,
  type AdminWorkSummary,
  type Work,
  type WorkProcessingStatus,
} from '@gloaming/shared/works';

type WorkPreviewInput = {
  processingStatus: WorkProcessingStatus;
  partCount?: number;
  parts?: readonly unknown[];
};

/** Whether admin work preview is available (parsed chapters, not in a blocking workflow state). */
export function canPreviewWork(work: WorkPreviewInput): boolean {
  const partCount = work.partCount ?? work.parts?.length ?? 0;
  return (
    partCount > 0 &&
    work.processingStatus !== 'processing' &&
    work.processingStatus !== 'metadata' &&
    work.processingStatus !== 'uploaded' &&
    work.processingStatus !== 'failed'
  );
}

export function isWorkPublished(work: { publishedAt: string | null }): boolean {
  return work.publishedAt != null;
}

/** TTS is a workflow step; while it runs the work processingStatus stays `ready`. */
export function isTtsWorkflowActive(work: { originMeta: Record<string, unknown> }): boolean {
  const enqueueStep = work.originMeta.workflowEnqueueStep;
  const claimStep = work.originMeta.workflowClaimStep;
  return enqueueStep === 'tts' || claimStep === 'tts';
}

export function isProcessingPipelineRunning(work: {
  processingStatus: WorkProcessingStatus;
  originMeta: Record<string, unknown>;
}): boolean {
  return work.processingStatus === 'processing' || work.processingStatus === 'metadata' || isTtsWorkflowActive(work);
}

export type AdminListStatusFilter = WorkProcessingStatus | 'all' | 'busy' | 'published';

export function adminWorksListQueryForFilter(filter: AdminListStatusFilter): Partial<AdminWorkListQuery> {
  switch (filter) {
    case 'all':
      return {};
    case 'busy':
      return { processingStatus: 'uploaded,processing,parsed,metadata,ready' };
    case 'published':
      return { publicationStatus: 'published' };
    case 'ready':
      return { processingStatus: 'ready', publicationStatus: 'unpublished' };
    case 'failed':
      return { processingStatus: 'failed' };
    default:
      return { processingStatus: filter };
  }
}

/** Client refinement when API filters cannot express TTS-step semantics on the busy tab. */
export function filterAdminWorksListItems(
  items: AdminWorkSummaryView[],
  filter: AdminListStatusFilter,
): AdminWorkSummaryView[] {
  switch (filter) {
    case 'busy':
      return items.filter(
        (work) =>
          work.processingStatus === 'uploaded' ||
          work.processingStatus === 'processing' ||
          work.processingStatus === 'parsed' ||
          work.processingStatus === 'metadata' ||
          isTtsWorkflowActive(work),
      );
    default:
      return items;
  }
}

/** Work view model: dates as ISO strings. */
export type WorkView = {
  id: string;
  title: string;
  author: string;
  description: string;
  language: string;
  processingStatus: Work['processingStatus'];
  visibility: Work['visibility'];
  originKind: Work['originKind'];
  tags: TaxonomyReference[];
  sources: SourceReference[];
  coverAssetId: string | null;
  wordCount: number | null;
  estimatedMinutes: number | null;
  suggestedVocabSize: number | null;
  difficultyScore: number | null;
  statsProvenance: Work['statsProvenance'];
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminWorkView = WorkView & {
  workflowPolicy: AdminWork['workflowPolicy'];
  derivedFreshness: AdminWork['derivedFreshness'];
  publishIssues: AdminWork['publishIssues'];
  originMeta: AdminWork['originMeta'];
  originAsset: AdminOriginAsset | null;
  parts: AdminWork['parts'];
  category: AdminWork['category'];
  failedStep: AdminWork['failedStep'];
  metadataProvenance: AdminWork['metadataProvenance'];
};

export type AdminWorkSummaryView = WorkView & {
  workflowPolicy: AdminWorkSummary['workflowPolicy'];
  derivedFreshness: AdminWorkSummary['derivedFreshness'];
  originMeta: AdminWorkSummary['originMeta'];
  originAsset: AdminOriginAsset | null;
  partCount: number;
  category: AdminWorkSummary['category'];
  failedStep: AdminWorkSummary['failedStep'];
  metadataProvenance: AdminWorkSummary['metadataProvenance'];
};

function toIso(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString();
}

export function normalizeWork(raw: Work): WorkView {
  return {
    id: raw.id,
    title: raw.title,
    author: raw.author,
    description: raw.description,
    language: raw.language,
    processingStatus: raw.processingStatus,
    visibility: raw.visibility,
    originKind: raw.originKind,
    tags: raw.tags,
    sources: raw.sources,
    coverAssetId: raw.coverAssetId,
    wordCount: raw.wordCount,
    estimatedMinutes: raw.estimatedMinutes,
    suggestedVocabSize: raw.suggestedVocabSize,
    difficultyScore: raw.difficultyScore,
    statsProvenance: raw.statsProvenance,
    publishedAt: raw.publishedAt == null ? null : toIso(raw.publishedAt),
    createdAt: toIso(raw.createdAt),
    updatedAt: toIso(raw.updatedAt),
  };
}

export function normalizeAdminWork(raw: AdminWork): AdminWorkView {
  return {
    ...normalizeWork(raw),
    workflowPolicy: raw.workflowPolicy,
    derivedFreshness: raw.derivedFreshness,
    publishIssues: raw.publishIssues,
    originMeta: raw.originMeta,
    originAsset: raw.originAsset,
    parts: raw.parts,
    category: raw.category,
    failedStep: raw.failedStep,
    metadataProvenance: raw.metadataProvenance,
  };
}

export function normalizeAdminWorkSummary(raw: AdminWorkSummary): AdminWorkSummaryView {
  return {
    ...normalizeWork(raw),
    workflowPolicy: raw.workflowPolicy,
    derivedFreshness: raw.derivedFreshness,
    originMeta: raw.originMeta,
    originAsset: raw.originAsset,
    partCount: raw.partCount,
    category: raw.category,
    failedStep: raw.failedStep,
    metadataProvenance: raw.metadataProvenance,
  };
}
