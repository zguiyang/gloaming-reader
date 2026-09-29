import { and, eq } from 'drizzle-orm';

import type { readingPart as readingPartTable } from '@gloaming/db';
import { readingState as readingStateTable } from '@gloaming/db';
import { type ReaderPartData, type ReaderPartsData, type ReadingState } from '@gloaming/shared/reader';
import { estimatedMinutesFromWordCount } from '@gloaming/shared/reading-stats';
import type { TaxonomyReference } from '@gloaming/shared/taxonomy';

import { getPartAudioAvailability } from '@/domains/assets';
import { toReadingState } from '@/domains/reading/reader/reading-state';
import type { WorkReadActor } from '@/domains/works/access';
import { requireReadablePart, requireReadableWorkWithParts } from '@/domains/works/access';
import { reindexLeafParagraphOrdinals } from '@/domains/works/content';
import { loadTagsForWork } from '@/domains/works/read-model';
import { db } from '@/infra/db';

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
  work: Awaited<ReturnType<typeof requireReadableWorkWithParts>>['work'],
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

export async function getReaderParts(actor: WorkReadActor, workId: string): Promise<ReaderPartsData> {
  const { work, parts } = await requireReadableWorkWithParts(actor, workId);
  const tags = await loadTagsForWork(workId);
  return {
    work: toWorkSummary(work, tags),
    parts: sortedParts(parts).map(toPartSummary),
  };
}

export async function getReaderPart(actor: WorkReadActor, partId: string): Promise<ReaderPartData> {
  const access = await requireReadablePart(actor, partId);
  const tags = await loadTagsForWork(access.workId);
  const audioAvailable = await getPartAudioAvailability(access.partId, access.partTitle, access.body);
  return {
    work: {
      id: access.workId,
      title: access.workTitle,
      coverAssetId: access.coverAssetId,
      tags,
    },
    part: {
      id: access.partId,
      workId: access.workId,
      sortOrder: access.sortOrder,
      kind: access.kind as ReaderPartData['part']['kind'],
      title: access.partTitle,
      body: reindexLeafParagraphOrdinals(access.body),
    },
    audioAvailable,
  };
}

export async function getReadingState(
  actor: WorkReadActor,
  userId: string,
  workId: string,
): Promise<ReadingState | null> {
  const { parts } = await requireReadableWorkWithParts(actor, workId);
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
