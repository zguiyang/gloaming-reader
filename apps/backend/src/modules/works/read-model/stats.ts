import { eq } from 'drizzle-orm';

import { readingPart as readingPartTable, readingWork as readingWorkTable } from '@gloaming/db';

import { db } from '@/db';
import { computePartReadingStats, computeWorkReadingStats } from '@/modules/reading-stats/service';

import type { WorkRow } from './projection';
import { loadPartsForWork } from './relations';

/** Backfill stats for works parsed before reading_work stats columns existed. */
export async function ensureWorkReadingStatsIfMissing(row: WorkRow): Promise<WorkRow> {
  if (row.wordCount != null) {
    return row;
  }

  const parts = await loadPartsForWork(row.id);
  if (parts.length === 0) {
    return row;
  }

  const preserveManualStats = row.statsProvenance === 'manual';
  const workStats = computeWorkReadingStats(
    parts.map((part) => ({ body: part.body })),
    row.language,
  );

  await db.transaction(async (tx) => {
    for (const part of parts) {
      const meta = part.meta as { wordCount?: unknown };
      if (typeof meta.wordCount === 'number') {
        continue;
      }
      const partStats = computePartReadingStats(part.body);
      await tx
        .update(readingPartTable)
        .set({ meta: { wordCount: partStats.wordCount } })
        .where(eq(readingPartTable.id, part.id));
    }

    await tx
      .update(readingWorkTable)
      .set({
        wordCount: workStats.wordCount,
        estimatedMinutes: workStats.estimatedMinutes,
        ...(preserveManualStats
          ? {}
          : {
              suggestedVocabSize: workStats.suggestedVocabSize,
              difficultyScore: workStats.difficultyScore,
              statsProvenance: workStats.statsProvenance,
            }),
      })
      .where(eq(readingWorkTable.id, row.id));
  });

  const [updated] = await db.select().from(readingWorkTable).where(eq(readingWorkTable.id, row.id)).limit(1);
  return updated ?? row;
}
