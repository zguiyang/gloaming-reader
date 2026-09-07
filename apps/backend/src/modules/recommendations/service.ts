import { and, desc, eq, inArray } from 'drizzle-orm';

import {
  category as categoryTable,
  readingState as readingStateTable,
  readingWork as readingWorkTable,
  readingWorkCategory as readingWorkCategoryTable,
} from '@gloaming/db';
import type { Work } from '@gloaming/shared';
import type { RecommendationsData, RecommendationsQuery } from '@gloaming/shared/recommendations';

import { db } from '@/db';
import { type RecommendationFeatures, resolveRecommendationOrder } from '@/modules/recommendations/score';
import { loadSourcesByWorkIds, loadTagsByWorkIds } from '@/modules/works/service';

type WorkRow = typeof readingWorkTable.$inferSelect;

function toIso(value: Date): string {
  return value.toISOString();
}

function toWork(row: WorkRow, tags: string[], sources: string[]): Work {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    description: row.description,
    language: row.language,
    status: row.status as Work['status'],
    visibility: row.visibility as Work['visibility'],
    originKind: row.originKind as Work['originKind'],
    tags,
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

function toFeatures(row: WorkRow, tags: string[], category: string | null): RecommendationFeatures {
  return {
    id: row.id,
    tags,
    category,
    language: row.language,
    difficultyScore: row.difficultyScore,
    suggestedVocabSize: row.suggestedVocabSize,
    estimatedMinutes: row.estimatedMinutes,
    publishedAt: row.publishedAt,
  };
}

async function loadCategoriesByWorkIds(workIds: string[]): Promise<Map<string, string>> {
  if (workIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ workId: readingWorkCategoryTable.workId, name: categoryTable.name })
    .from(readingWorkCategoryTable)
    .innerJoin(categoryTable, eq(readingWorkCategoryTable.categoryId, categoryTable.id))
    .where(inArray(readingWorkCategoryTable.workId, workIds));
  const map = new Map<string, string>();
  for (const row of rows) {
    if (!map.has(row.workId)) {
      map.set(row.workId, row.name);
    }
  }
  return map;
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

  const publishedRows = await db
    .select()
    .from(readingWorkTable)
    .where(and(eq(readingWorkTable.status, 'published'), eq(readingWorkTable.visibility, 'catalog')))
    .orderBy(desc(readingWorkTable.publishedAt), desc(readingWorkTable.id));

  const allIds = publishedRows.map((row) => row.id);
  const tagsByWork = await loadTagsByWorkIds(allIds);
  const categoryByWork = await loadCategoriesByWorkIds(allIds);

  const featuresById = new Map<string, RecommendationFeatures>();
  for (const row of publishedRows) {
    featuresById.set(row.id, toFeatures(row, tagsByWork.get(row.id) ?? [], categoryByWork.get(row.id) ?? null));
  }

  const shelfWorkIds = stateRows.map((row) => row.workId);
  const shelfWorks = shelfWorkIds
    .map((id) => featuresById.get(id))
    .filter((row): row is RecommendationFeatures => row != null);

  let current: RecommendationFeatures | null = null;
  const inProgress = stateRows
    .filter((row) => row.status === 'in_progress')
    .sort((a, b) => b.lastReadAt.getTime() - a.lastReadAt.getTime() || b.workId.localeCompare(a.workId));
  const currentId = inProgress[0]?.workId;
  if (currentId) {
    current = featuresById.get(currentId) ?? null;
  }

  const candidates = publishedRows
    .filter((row) => !exclude.has(row.id))
    .map((row) => featuresById.get(row.id))
    .filter((row): row is RecommendationFeatures => row != null);

  const plan = resolveRecommendationOrder({
    limit: query.limit,
    current,
    shelfWorks,
    candidates,
  });

  const selectedRows = plan.orderedIds
    .map((id) => publishedRows.find((row) => row.id === id))
    .filter((row): row is WorkRow => row != null);

  const sourcesByWork = await loadSourcesByWorkIds(selectedRows.map((row) => row.id));

  return {
    strategy: plan.strategy,
    anchorWorkId: plan.anchorWorkId,
    items: selectedRows.map((row) => toWork(row, tagsByWork.get(row.id) ?? [], sourcesByWork.get(row.id) ?? [])),
  };
}
