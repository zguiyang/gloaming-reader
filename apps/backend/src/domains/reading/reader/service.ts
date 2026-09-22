import { and, eq } from 'drizzle-orm';

import type { readingPart as readingPartTable } from '@gloaming/db';
import { readingState as readingStateTable } from '@gloaming/db';
import { type ReaderPartData, type ReaderPartsData, type ReadingState } from '@gloaming/shared/reader';
import { estimatedMinutesFromWordCount } from '@gloaming/shared/reading-stats';
import type { TaxonomyReference } from '@gloaming/shared/taxonomy';

import { getPartAudioAvailability } from '@/domains/assets';
import { toReadingState } from '@/domains/reading/reader/reading-state';
import { reindexLeafParagraphOrdinals } from '@/domains/works/content';
import { getPartById, loadTagsForWork, requirePublishedWorkWithParts } from '@/domains/works/read-model';
import { db } from '@/infra/db';
import { NotFoundError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

type PartRow = typeof readingPartTable.$inferSelect;

function toIso(value: Date): string {
  return value.toISOString();
}

function sortedParts(parts: PartRow[]): PartRow[] {
  return [...parts].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

function toPartSummary(part: PartRow) {
  const meta = part.meta as { wordCount?: unknown };
  const wordCount = typeof meta.wordCount === 'number' ? meta.wordCount : null;
  return {
    id: part.id,
    workId: part.workId,
    sortOrder: part.sortOrder,
    kind: part.kind as ReaderPartsData['parts'][number]['kind'],
    title: part.title,
    wordCount,
    estimatedMinutes: wordCount != null ? estimatedMinutesFromWordCount(wordCount) : null,
    createdAt: toIso(part.createdAt),
    updatedAt: toIso(part.updatedAt),
  };
}

function toWorkSummary(
  work: Awaited<ReturnType<typeof requirePublishedWorkWithParts>>['work'],
  tags: TaxonomyReference[],
): ReaderPartsData['work'] {
  return {
    id: work.id,
    title: work.title,
    description: work.description,
    tags,
    coverAssetId: work.coverAssetId,
    publishedAt: work.publishedAt ? toIso(work.publishedAt) : null,
  };
}

export async function getReaderParts(workId: string): Promise<ReaderPartsData> {
  const { work, parts } = await requirePublishedWorkWithParts(workId);
  const tags = await loadTagsForWork(workId);
  return {
    work: toWorkSummary(work, tags),
    parts: sortedParts(parts).map(toPartSummary),
  };
}

export async function getReaderPart(partId: string): Promise<ReaderPartData> {
  const part = await getPartById(partId);
  const { work, parts } = await requirePublishedWorkWithParts(part.workId);
  if (!parts.some((row) => row.id === partId)) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.PART);
  }
  const tags = await loadTagsForWork(work.id);
  const audioAvailable = await getPartAudioAvailability(part.id, part.title, part.body);
  return {
    work: {
      id: work.id,
      title: work.title,
      coverAssetId: work.coverAssetId,
      tags,
    },
    part: {
      id: part.id,
      workId: part.workId,
      sortOrder: part.sortOrder,
      kind: part.kind as ReaderPartData['part']['kind'],
      title: part.title,
      body: reindexLeafParagraphOrdinals(part.body),
    },
    audioAvailable,
  };
}

export async function getReadingState(userId: string, workId: string): Promise<ReadingState | null> {
  const { parts } = await requirePublishedWorkWithParts(workId);
  const [row] = await db
    .select()
    .from(readingStateTable)
    .where(and(eq(readingStateTable.userId, userId), eq(readingStateTable.workId, workId)))
    .limit(1);
  if (!row) {
    return null;
  }
  return toReadingState(row, parts);
}
