import type { readingPart as readingPartTable, readingWork as readingWorkTable } from '@gloaming/db';
import type { SourceReference, TaxonomyReference } from '@gloaming/shared/taxonomy';
import { type Part, type Work } from '@gloaming/shared/works';

export type WorkRow = typeof readingWorkTable.$inferSelect;
export type PartRow = typeof readingPartTable.$inferSelect;

function toIso(value: Date): string {
  return value.toISOString();
}

export function toWork(
  row: WorkRow,
  tags: TaxonomyReference[],
  sources: SourceReference[],
  category: TaxonomyReference | null = null,
): Work {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    description: row.description,
    language: row.language,
    processingStatus: row.processingStatus as Work['processingStatus'],
    visibility: row.visibility as Work['visibility'],
    tags,
    category,
    sources,
    coverAssetId: row.coverAssetId,
    wordCount: row.wordCount,
    estimatedMinutes: row.estimatedMinutes,
    suggestedVocabSize: row.suggestedVocabSize,
    difficultyScore: row.difficultyScore,
    statsProvenance: row.statsProvenance,
    publishedAt: row.publishedAt ? toIso(row.publishedAt) : null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function toPart(row: PartRow): Part {
  return {
    id: row.id,
    workId: row.workId,
    sortOrder: row.sortOrder,
    kind: row.kind as Part['kind'],
    title: row.title,
    body: row.body,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}
