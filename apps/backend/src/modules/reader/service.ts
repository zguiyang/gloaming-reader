import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import type { readingPart as readingPartTable } from '@gloaming/db';
import { readingState as readingStateTable } from '@gloaming/db';
import {
  computeChapterProgress,
  mergeReadingCompletion,
  mergeReadingPosition,
  NO_CHAPTERS_COMPLETED,
  type PartSortOrder,
  type ReaderPartData,
  type ReaderPartsData,
  type ReadingState,
  type UpdateReadingStateBody,
} from '@gloaming/shared/reader';
import { estimatedMinutesFromWordCount } from '@gloaming/shared/reading-stats';

import { db } from '@/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { getPartAudioAvailability, getPublishedPartAudioTrack } from '@/modules/content-assets/service';
import { reindexLeafParagraphOrdinals } from '@/modules/epub-ingest/clean';
import { touchReadingDay } from '@/modules/reading-history/service';
import { getPartById, loadTagsForWork, requirePublishedWorkWithParts } from '@/modules/works/service';

type StateRow = typeof readingStateTable.$inferSelect;
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
  tags: string[],
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

function toReadingState(row: StateRow, parts: PartSortOrder[]): ReadingState {
  const partSortOrders = parts.map((part) => ({ sortOrder: part.sortOrder }));
  const completedThrough = row.completedThroughSortOrder ?? NO_CHAPTERS_COMPLETED;
  return {
    status: row.status as ReadingState['status'],
    currentPartId: row.currentPartId,
    completedThroughSortOrder: completedThrough,
    revision: row.revision,
    progressRatio: computeChapterProgress({
      status: row.status as ReadingState['status'],
      completedThroughSortOrder: completedThrough,
      parts: partSortOrders,
    }),
    totalPartCount: parts.length,
    lastReadAt: toIso(row.lastReadAt),
    completedAt: row.completedAt ? toIso(row.completedAt) : null,
  };
}

function findPart(parts: PartRow[], partId: string): PartRow {
  const part = parts.find((row) => row.id === partId);
  if (!part) {
    throw new NotFoundError('Part');
  }
  return part;
}

function nextPartAfter(parts: PartRow[], current: PartRow): PartRow | null {
  const ordered = sortedParts(parts);
  const index = ordered.findIndex((part) => part.id === current.id);
  if (index < 0 || index >= ordered.length - 1) {
    return null;
  }
  return ordered[index + 1] ?? null;
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
    throw new NotFoundError('Part');
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

export async function updateReadingState(
  userId: string,
  workId: string,
  input: UpdateReadingStateBody,
): Promise<ReadingState> {
  const { parts } = await requirePublishedWorkWithParts(workId);
  const ordered = sortedParts(parts);
  const firstPart = ordered[0]!;
  const now = new Date();
  const state = await db.transaction(async (tx) => {
    let [existing] = await tx
      .select()
      .from(readingStateTable)
      .where(and(eq(readingStateTable.userId, userId), eq(readingStateTable.workId, workId)))
      .for('update')
      .limit(1);

    if (!existing && (input.action === 'add_to_shelf' || input.action === 'open' || input.action === 'restart')) {
      const [created] = await tx
        .insert(readingStateTable)
        .values({
          id: randomUUID(),
          userId,
          workId,
          currentPartId: firstPart.id,
          completedThroughSortOrder: NO_CHAPTERS_COMPLETED,
          status: 'in_progress',
          addedAt: now,
          lastReadAt: now,
          completedAt: null,
        })
        .onConflictDoNothing({ target: [readingStateTable.userId, readingStateTable.workId] })
        .returning();
      existing = created;
      if (!existing) {
        [existing] = await tx
          .select()
          .from(readingStateTable)
          .where(and(eq(readingStateTable.userId, userId), eq(readingStateTable.workId, workId)))
          .for('update')
          .limit(1);
      }
    }

    if (!existing) {
      throw new NotFoundError('Reading state');
    }
    if (input.expectedRevision != null && input.expectedRevision !== existing.revision) {
      throw new AppError(409, 'Reading state revision conflict');
    }

    const updateState = async (changes: Partial<typeof readingStateTable.$inferInsert>): Promise<StateRow> => {
      const [updated] = await tx
        .update(readingStateTable)
        .set({
          ...changes,
          revision: sql`${readingStateTable.revision} + 1`,
        })
        .where(and(eq(readingStateTable.id, existing.id), eq(readingStateTable.revision, existing.revision)))
        .returning();
      if (!updated) {
        throw new AppError(409, 'Reading state revision conflict');
      }
      return updated;
    };

    if (input.action === 'add_to_shelf') {
      return existing;
    }

    const currentPart = existing.currentPartId ? parts.find((part) => part.id === existing.currentPartId) : undefined;
    const currentPartId = currentPart?.id ?? null;
    const requestedPartId = input.partId && parts.some((part) => part.id === input.partId) ? input.partId : undefined;

    if (input.action === 'open') {
      const mergedPartId = mergeReadingPosition({
        action: input.action,
        currentPartId,
        requestedPartId,
      });
      return updateState({ currentPartId: mergedPartId ?? firstPart.id, lastReadAt: now });
    }

    if (input.action === 'restart') {
      const mergedPartId = mergeReadingPosition({
        action: input.action,
        currentPartId,
        restartPartId: requestedPartId ?? firstPart.id,
      });
      return updateState({
        status: 'in_progress',
        currentPartId: mergedPartId ?? firstPart.id,
        completedThroughSortOrder: NO_CHAPTERS_COMPLETED,
        completedAt: null,
        lastReadAt: now,
      });
    }

    if (input.action === 'complete_chapter') {
      const current = currentPart ?? firstPart;
      const completedThrough = mergeReadingCompletion(
        existing.completedThroughSortOrder ?? NO_CHAPTERS_COMPLETED,
        current.sortOrder,
      );
      const next = input.nextPartId != null ? findPart(parts, input.nextPartId) : nextPartAfter(parts, current);
      if (!next) {
        throw new AppError(400, 'No next chapter — use finish to complete the book');
      }
      return updateState({
        currentPartId: next.id,
        completedThroughSortOrder: completedThrough,
        ...(existing.status === 'completed' ? {} : { status: 'in_progress', completedAt: null }),
        lastReadAt: now,
      });
    }

    if (input.action === 'navigate') {
      const target = findPart(parts, input.partId!);
      return updateState({
        currentPartId: target.id,
        lastReadAt: now,
      });
    }

    if (input.action === 'finish') {
      const maxSort = ordered[ordered.length - 1]!.sortOrder;
      return updateState({
        status: 'completed',
        completedThroughSortOrder: mergeReadingCompletion(
          existing.completedThroughSortOrder ?? NO_CHAPTERS_COMPLETED,
          maxSort,
        ),
        completedAt: existing.completedAt ?? now,
        lastReadAt: now,
      });
    }

    throw new AppError(400, 'Unsupported action');
  });

  await touchReadingDay(userId);
  return toReadingState(state, parts);
}

export { getPublishedPartAudioTrack, toReadingState };
