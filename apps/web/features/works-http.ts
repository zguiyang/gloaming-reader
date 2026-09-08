import { type ReaderPartsData, readerPartsDataSchema } from '@gloaming/shared/reader';
import { type ShelfData, shelfDataSchema, type ShelfItem } from '@gloaming/shared/shelf';
import {
  type AdminOriginAsset,
  type AdminWork,
  type AdminWorkSummary,
  type Work,
  workSchema,
} from '@gloaming/shared/works';

import { apiRequest } from '@/lib/api-request';

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

export async function getPublishedWork(workId: string, init?: { signal?: AbortSignal }): Promise<Work> {
  return apiRequest(`/api/catalog/works/${encodeURIComponent(workId)}`, {
    schema: workSchema,
    signal: init?.signal,
  });
}

export async function getWorkParts(workId: string, init?: { signal?: AbortSignal }): Promise<ReaderPartsData> {
  return apiRequest(`/api/reader/works/${encodeURIComponent(workId)}/parts`, {
    schema: readerPartsDataSchema,
    signal: init?.signal,
  });
}

export async function getShelf(init?: { signal?: AbortSignal }): Promise<ShelfData> {
  return apiRequest('/api/shelf', {
    schema: shelfDataSchema,
    signal: init?.signal,
  });
}

export function buildShelfItemMap(data: ShelfData): Map<string, ShelfItem> {
  const map = new Map<string, ShelfItem>();
  if (data.current) {
    map.set(data.current.work.id, data.current);
  }
  for (const item of data.items) {
    map.set(item.work.id, item);
  }
  return map;
}

export function coverUrlFromAssetId(coverAssetId: string | null): string | null {
  if (!coverAssetId) {
    return null;
  }
  return `/api/assets/${encodeURIComponent(coverAssetId)}`;
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
