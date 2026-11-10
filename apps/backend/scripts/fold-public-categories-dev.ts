/**
 * One-off dev fold: collapse fine public categories into eight Discover genres.
 * Run: pnpm --filter @gloaming/backend fold:public-categories
 */
import { count, eq, sql } from 'drizzle-orm';

import {
  discoverySource,
  publicCategory,
  publicCategoryLabel,
  sourceCategoryMapping,
  sourceCategoryMappingCategory,
  sourceRecordPublicCategory,
} from '@gloaming/db/schema';
import { normalizePublicCategoryName } from '@gloaming/shared/discovery';

import {
  createManagedCategory,
  deleteManagedCategory,
  updateManagedCategoryLabel,
} from '@/domains/discovery/categories/service';
import {
  recomputeAllRecordsForConfirmedShelves,
  saveCategoryShelfTerms,
} from '@/domains/discovery/categories/shelf-terms-admin';
import { GUTENBERG_CATEGORY_BOOKSHELF_PREFIX } from '@/domains/discovery/categories/source-category-mapping';
import { PROJECT_GUTENBERG_SOURCE_KEY } from '@/domains/discovery/gutenberg/constants';

import { db } from '../src/infra/db/index.ts';

const TARGETS = [
  {
    zh: '小说',
    en: 'Fiction',
    pattern: /fiction|novel|adventure|science[- ]fiction|fantasy|mystery|horror|romance|humou?r|short story/i,
  },
  { zh: '历史', en: 'History', pattern: /history|war/i },
  { zh: '科学', en: 'Science', pattern: /science|physics|chemistry|biology|mathematics|astronomy|medicine/i },
  { zh: '传记', en: 'Biography', pattern: /biograph|autobiograph|memoir/i },
  { zh: '儿童', en: 'Children', pattern: /children|juvenile/i },
  { zh: '诗歌', en: 'Poetry', pattern: /poetry|poem/i },
  { zh: '戏剧', en: 'Drama', pattern: /drama|play|theatre|theater/i },
  { zh: '哲学', en: 'Philosophy', pattern: /philosophy|ethics/i },
] as const;

function assertDevDatabase(url: string): void {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/gloaming_backend') {
    console.error('Refusing to run: DATABASE_URL must point at 127.0.0.1/gloaming_backend');
    process.exit(1);
  }
}

function matchBigGenre(haystack: string): string | null {
  const match = TARGETS.find((row) => row.pattern.test(haystack));
  return match?.en ?? null;
}

async function ensureBigCategory(target: (typeof TARGETS)[number]): Promise<string> {
  const englishKey = normalizePublicCategoryName(target.en);
  const [existing] = await db
    .select({ categoryId: publicCategoryLabel.categoryId })
    .from(publicCategoryLabel)
    .where(eq(publicCategoryLabel.normalizedName, englishKey))
    .limit(1);
  if (existing) {
    await updateManagedCategoryLabel(existing.categoryId, { name: target.zh, locale: 'zh-CN' });
    await updateManagedCategoryLabel(existing.categoryId, { name: target.en, locale: 'en-US' });
    return existing.categoryId;
  }
  const created = await createManagedCategory({ name: target.zh, locale: 'zh-CN' });
  await updateManagedCategoryLabel(created.id, { name: target.en, locale: 'en-US' });
  return created.id;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  assertDevDatabase(databaseUrl);

  const [source] = await db
    .select()
    .from(discoverySource)
    .where(eq(discoverySource.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY))
    .limit(1);
  if (!source) {
    console.error('Project Gutenberg source is missing');
    process.exit(1);
  }

  const bigIds = new Map<string, string>();
  for (const target of TARGETS) {
    bigIds.set(target.en, await ensureBigCategory(target));
  }

  const shelfRows = await db
    .select()
    .from(sourceCategoryMapping)
    .where(
      sql`${sourceCategoryMapping.sourceId} = ${source.id} AND ${sourceCategoryMapping.sourceValue} like ${GUTENBERG_CATEGORY_BOOKSHELF_PREFIX + '%'}`,
    );

  const links = await db.select().from(sourceCategoryMappingCategory);
  const linksByMapping = new Map(links.map((row) => [row.mappingId, row.categoryId]));
  const fineLabels = await db.select().from(publicCategoryLabel);
  const labelByCategory = new Map(fineLabels.map((row) => [row.categoryId, row]));

  const mappingReport: Array<{ shelf: string; oldCategory: string; newCategory: string | null }> = [];
  const bigToMappings = new Map<string, string[]>();

  for (const mapping of shelfRows) {
    const currentCategoryId = linksByMapping.get(mapping.id) ?? null;
    const currentLabel = currentCategoryId
      ? (labelByCategory.get(currentCategoryId)?.name ?? currentCategoryId)
      : 'unassigned';
    const haystack = `${mapping.sourceValue} ${currentLabel}`;
    const matched = matchBigGenre(haystack);
    if (!matched) {
      mappingReport.push({ shelf: mapping.sourceValue, oldCategory: currentLabel, newCategory: null });
      continue;
    }
    const categoryId = bigIds.get(matched)!;
    mappingReport.push({ shelf: mapping.sourceValue, oldCategory: currentLabel, newCategory: matched });
    const list = bigToMappings.get(categoryId) ?? [];
    list.push(mapping.id);
    bigToMappings.set(categoryId, list);
  }

  for (const [categoryId, mappingIds] of bigToMappings) {
    await saveCategoryShelfTerms(categoryId, [...new Set(mappingIds)]);
  }

  await recomputeAllRecordsForConfirmedShelves(source.id);

  const keepIds = new Set([...bigIds.values()]);
  const fineCategories = await db.select({ id: publicCategory.id }).from(publicCategory);
  for (const category of fineCategories) {
    if (keepIds.has(category.id)) continue;
    await deleteManagedCategory(category.id);
  }

  const [categoryCount] = await db.select({ value: count() }).from(publicCategory);
  const [linkCount] = await db.select({ value: count() }).from(sourceCategoryMappingCategory);
  const [recordCount] = await db.select({ value: count() }).from(sourceRecordPublicCategory);
  const unassigned = mappingReport.filter((row) => row.newCategory === null);

  console.log('Public category fold complete');
  console.log(`categories remaining: ${categoryCount?.value ?? 0}`);
  console.log(`shelf links: ${linkCount?.value ?? 0}`);
  console.log(`records with category: ${recordCount?.value ?? 0}`);
  console.log(`unassigned shelves: ${unassigned.length}`);
  console.log('Mappings:');
  for (const row of mappingReport.slice(0, 80)) {
    console.log(`- ${row.shelf}: ${row.oldCategory} -> ${row.newCategory ?? 'unassigned'}`);
  }
  if (mappingReport.length > 80) {
    console.log(`... and ${mappingReport.length - 80} more`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
