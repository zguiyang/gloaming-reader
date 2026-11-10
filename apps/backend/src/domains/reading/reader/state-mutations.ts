import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import type { readingPart as readingPartTable } from '@gloaming/db';
import { readingState as readingStateTable } from '@gloaming/db';
import {
  mergeReadingCompletion,
  mergeReadingPosition,
  NO_CHAPTERS_COMPLETED,
  READING_STATE_ANCHOR_KIND,
  type ReadingState,
  type UpdateReadingStateBody,
} from '@gloaming/shared/reader';

import { touchReadingDay } from '@/domains/reading/history';
import { toReadingState } from '@/domains/reading/reader/reading-state';
import type { WorkReadActor } from '@/domains/works/access';
import { requireReadableWorkWithParts } from '@/domains/works/access';
import { db } from '@/infra/db';
import { AppError, NotFoundError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

type StateRow = typeof readingStateTable.$inferSelect;
type PartRow = typeof readingPartTable.$inferSelect;

function sortedParts(parts: PartRow[]): PartRow[] {
  return [...parts].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

function findPart(parts: PartRow[], partId: string): PartRow {
  const part = parts.find((row) => row.id === partId);
  if (!part) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.PART);
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

export async function updateReadingState(
  actor: WorkReadActor,
  userId: string,
  workId: string,
  input: UpdateReadingStateBody,
): Promise<ReadingState> {
  const { parts } = await requireReadableWorkWithParts(actor, workId);
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

    if (!existing && (input.action === 'open' || input.action === 'restart')) {
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
      throw new NotFoundError(ERROR_CODES.NOT_FOUND.READING_STATE);
    }
    if (input.expectedRevision != null && input.expectedRevision !== existing.revision) {
      throw new AppError(409, ERROR_CODES.READER.REVISION_CONFLICT);
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
        throw new AppError(409, ERROR_CODES.READER.REVISION_CONFLICT);
      }
      return updated;
    };

    /**
     * Background within-chapter position write. Deliberately does not bump
     * `revision`, so it never invalidates another client's chapter-navigation
     * CAS revision or surfaces a conflict toast. The `revision =` predicate
     * still makes a write that lost a race to a chapter change a silent no-op.
     */
    const updateAnchor = async (anchorValue: string): Promise<StateRow> => {
      const [updated] = await tx
        .update(readingStateTable)
        .set({ anchorKind: READING_STATE_ANCHOR_KIND, anchorValue })
        .where(and(eq(readingStateTable.id, existing.id), eq(readingStateTable.revision, existing.revision)))
        .returning();
      if (updated) {
        return updated;
      }
      const [current] = await tx.select().from(readingStateTable).where(eq(readingStateTable.id, existing.id)).limit(1);
      return current ?? existing;
    };

    const currentPart = existing.currentPartId ? parts.find((part) => part.id === existing.currentPartId) : undefined;
    const currentPartId = currentPart?.id ?? null;
    const requestedPartId = input.partId && parts.some((part) => part.id === input.partId) ? input.partId : undefined;
    const clearedAnchor = { anchorKind: null, anchorValue: null } as const;

    if (input.action === 'save_position') {
      const anchor = input.anchor!;
      // Only accept a position for the part that is still current; a stale
      // write from a part the reader already left is ignored.
      if (anchor.partId !== currentPartId) {
        return existing;
      }
      return updateAnchor(JSON.stringify(anchor));
    }

    if (input.action === 'open') {
      const mergedPartId = mergeReadingPosition({
        action: input.action,
        currentPartId,
        requestedPartId,
      });
      const nextPartId = mergedPartId ?? firstPart.id;
      const changes = { currentPartId: nextPartId, lastReadAt: now };
      return updateState(nextPartId === currentPartId ? changes : { ...changes, ...clearedAnchor });
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
        ...clearedAnchor,
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
        throw new AppError(400, ERROR_CODES.READER.NO_NEXT_CHAPTER);
      }
      return updateState({
        currentPartId: next.id,
        completedThroughSortOrder: completedThrough,
        ...(existing.status === 'completed' ? {} : { status: 'in_progress', completedAt: null }),
        lastReadAt: now,
        ...clearedAnchor,
      });
    }

    if (input.action === 'navigate') {
      const target = findPart(parts, input.partId!);
      const changes = { currentPartId: target.id, lastReadAt: now };
      return updateState(target.id === currentPartId ? changes : { ...changes, ...clearedAnchor });
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

    throw new AppError(400, ERROR_CODES.READER.UNSUPPORTED_ACTION);
  });

  if (input.action !== 'save_position') {
    await touchReadingDay(userId);
  }
  return toReadingState(state, parts);
}
