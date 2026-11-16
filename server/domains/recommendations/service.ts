import { desc, eq, inArray } from 'drizzle-orm';

import { readingState as readingStateTable, readingWork as readingWorkTable } from '@/server/db';
import type { RecommendationsData, RecommendationsQuery } from '@/shared/recommendations';
import type { Work } from '@/shared/works';

import { type RecommendationFeatures, resolveRecommendationOrder } from '@/server/domains/recommendations/score';
import { publicCatalogWorkSql } from '@/server/domains/works/access';
import { db } from '@/server/infra/db';

/** Soft cap on catalog rows scored per request (newest-first). Shelf anchors are loaded separately. */
const RECOMMENDATION_CANDIDATE_POOL = 250;

type WorkRow = typeof readingWorkTable.$inferSelect;
type FeatureRow = {
  id: string;
  language: string;
  difficultyScore: number | null;
  suggestedVocabSize: number | null;
  estimatedMinutes: number | null;
  publishedAt: Date | null;
};

const featureColumns = {
  id: readingWorkTable.id,
  language: readingWorkTable.language,
  difficultyScore: readingWorkTable.difficultyScore,
  suggestedVocabSize: readingWorkTable.suggestedVocabSize,
  estimatedMinutes: readingWorkTable.estimatedMinutes,
  publishedAt: readingWorkTable.publishedAt,
} as const;

function toIso(value: Date): string {
  return value.toISOString();
}

function toWork(row: WorkRow): Work {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    description: row.description,
    language: row.language,
    processingStatus: row.processingStatus as Work['processingStatus'],
    visibility: row.visibility as Work['visibility'],
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

export async function getRecommendations(userId: string, query: RecommendationsQuery): Promise<RecommendationsData> {
  const exclude = new Set<string>();
  if (query.excludeWorkId) {
    exclude.add(query.excludeWorkId);
  }

  const stateRows = await db
    .select({
      workId: readingStateTable.workId,
      status: readingStateTable.status,
      lastReadAt: readingStateTable.lastReadAt,
    })
    .from(readingStateTable)
    .where(eq(readingStateTable.userId, userId));

  for (const row of stateRows) {
    exclude.add(row.workId);
  }

  // Score from the feature columns only, over a bounded newest-first pool.
  // Loading the entire public catalog per request still dominated cost after the
  // full-row trim; shelf / current anchors that fall outside the pool are loaded
  // by id below.
  const candidateRows: FeatureRow[] = await db
    .select(featureColumns)
    .from(readingWorkTable)
    .where(publicCatalogWorkSql())
    .orderBy(desc(readingWorkTable.publishedAt), desc(readingWorkTable.id))
    .limit(RECOMMENDATION_CANDIDATE_POOL);

  const featuresById = new Map<string, RecommendationFeatures>();
  for (const row of candidateRows) {
    featuresById.set(row.id, row);
  }

  const shelfWorkIds = stateRows.map((row) => row.workId);
  const missingShelfIds = shelfWorkIds.filter((id) => !featuresById.has(id));
  if (missingShelfIds.length > 0) {
    const shelfFeatureRows: FeatureRow[] = await db
      .select(featureColumns)
      .from(readingWorkTable)
      .where(inArray(readingWorkTable.id, missingShelfIds));
    for (const row of shelfFeatureRows) {
      featuresById.set(row.id, row);
    }
  }

  const shelfWorks = shelfWorkIds.map((id) => featuresById.get(id)).filter((row) => row != null);

  let current: RecommendationFeatures | null = null;
  const inProgress = stateRows
    .filter((row) => row.status === 'in_progress')
    .sort((a, b) => b.lastReadAt.getTime() - a.lastReadAt.getTime() || b.workId.localeCompare(a.workId));
  const currentId = inProgress[0]?.workId;
  if (currentId) {
    current = featuresById.get(currentId) ?? null;
  }

  const candidates = candidateRows
    .filter((row) => !exclude.has(row.id))
    .map((row) => featuresById.get(row.id))
    .filter((row) => row != null);

  const plan = resolveRecommendationOrder({
    limit: query.limit,
    current,
    shelfWorks,
    candidates,
  });

  // Fetch full rows for the selected ids only, then restore the planned order.
  const selectedRows =
    plan.orderedIds.length > 0
      ? await db.select().from(readingWorkTable).where(inArray(readingWorkTable.id, plan.orderedIds))
      : [];
  const selectedById = new Map(selectedRows.map((row) => [row.id, row]));
  const orderedRows = plan.orderedIds.map((id) => selectedById.get(id)).filter((row): row is WorkRow => row != null);

  return {
    strategy: plan.strategy,
    anchorWorkId: plan.anchorWorkId,
    items: orderedRows.map((row) => toWork(row)),
  };
}
