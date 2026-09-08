import { type AdminOriginAsset, type AdminWork, type AdminWorkSummary, type Work } from '@gloaming/shared/works';

/** Work view model: dates as ISO strings. */
export type WorkView = {
  id: string;
  title: string;
  author: string;
  description: string;
  language: string;
  status: Work['status'];
  visibility: Work['visibility'];
  originKind: Work['originKind'];
  tags: string[];
  sources: string[];
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
    status: raw.status,
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
