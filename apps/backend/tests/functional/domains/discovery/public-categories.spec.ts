import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  discoverySource as discoverySourceTable,
  sourceRecord as sourceRecordTable,
  sourceRecordPublicCategorySuppression as sourceRecordPublicCategorySuppressionTable,
} from '@gloaming/db/schema';
import { categorySourceRecordListQuerySchema, sourceRecordListQuerySchema } from '@gloaming/shared/discovery';

import {
  assignCategoryToSourceRecord,
  createManagedCategory,
  getPublicCategory,
  listManagedCategories,
  listManagedCategorySourceRecords,
  listPublicCategories,
  unassignCategoryFromSourceRecord,
  updateManagedCategoryLabel,
} from '@/domains/discovery/categories';
import { listAssignmentsForRecord } from '@/domains/discovery/categories/repository';
import type { ParsedSourceRecord } from '@/domains/discovery/gutenberg/rdf-record';
import { listSourceRecords } from '@/domains/discovery/read-model';
import { ensureDiscoverySource, upsertSourceRecords } from '@/domains/discovery/sync/repository';
import { db } from '@/infra/db';

const runId = randomUUID();
const sourceKey = `pc02_categories_${runId}`;
let sourceId = '';
let schemaReady = false;
const createdCategoryIds = new Set<string>();

/**
 * The public_category tables come from the AC-01 foundation migrations. When the
 * isolated test database has not applied them yet, these integration checks are
 * reported as skipped rather than failing for a missing schema.
 */
async function detectCategorySchema(): Promise<boolean> {
  const result = (await db.execute(
    sql`select to_regclass('public.public_category') is not null
        and to_regclass('public.source_record_public_category_suppression') is not null as ready`,
  )) as { rows: Array<{ ready: boolean }> };
  return Boolean(result.rows[0]?.ready);
}

function fixtureRecord(index: number): ParsedSourceRecord {
  return {
    externalId: `${runId}-${index}`,
    title: `Category Fixture ${index}`,
    authors: [{ name: `Author ${index}`, role: 'author' }],
    languages: ['en'],
    description: null,
    rightsStatement: null,
    coverUrl: null,
    contentCandidates: [],
    sourceMeta: {},
    sourceUpdatedAt: null,
  };
}

async function recordIdFor(index: number): Promise<string> {
  const [row] = await db
    .select({ id: sourceRecordTable.id })
    .from(sourceRecordTable)
    .where(eq(sourceRecordTable.externalId, `${runId}-${index}`))
    .limit(1);
  return row!.id;
}

async function createCategory(name: string, locale = 'en-US') {
  const category = await createManagedCategory({ name, locale });
  createdCategoryIds.add(category.id);
  return category;
}

describe('public category service on gloaming_test', () => {
  beforeAll(async () => {
    schemaReady = await detectCategorySchema();
    if (!schemaReady) return;
    const source = await ensureDiscoverySource(sourceKey, 'gutenberg_rdf');
    sourceId = source.id;
    await upsertSourceRecords(sourceId, [fixtureRecord(1), fixtureRecord(2)], new Date('2026-01-01T00:00:00.000Z'));
  });

  afterAll(async () => {
    if (sourceId) {
      await db.delete(sourceRecordTable).where(eq(sourceRecordTable.sourceId, sourceId));
      await db.delete(discoverySourceTable).where(eq(discoverySourceTable.id, sourceId));
    }
    if (createdCategoryIds.size > 0) {
      await db.execute(
        sql`delete from public_category where id in (${sql.join(
          [...createdCategoryIds].map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
    }
  });

  it('reuses the existing category for a normalized-name collision', async (ctx) => {
    if (!schemaReady) return ctx.skip();

    const created = await createCategory('  Science   Fiction ');
    expect(created.localizedNames).toEqual({ 'en-US': 'Science Fiction' });
    expect(created.manualLocales).toEqual(['en-US']);
    expect(created.recordCount).toBe(0);

    const reused = await createCategory('science fiction');
    expect(reused.id).toBe(created.id);
  });

  it('enforces per-locale normalized uniqueness and preserves manually edited labels', async (ctx) => {
    if (!schemaReady) return ctx.skip();

    const scifi = await createCategory('Science Fiction');
    const other = await createCategory('Fantasy');

    const localized = await updateManagedCategoryLabel(other.id, { name: 'History', locale: 'en-US' });
    expect(localized.localizedNames['en-US']).toBe('History');
    expect(localized.manualLocales).toContain('en-US');

    const bilingual = await updateManagedCategoryLabel(scifi.id, { name: '科幻小说', locale: 'zh-CN' });
    expect(bilingual.localizedNames).toEqual({ 'en-US': 'Science Fiction', 'zh-CN': '科幻小说' });
    expect(bilingual.manualLocales).toEqual(['en-US', 'zh-CN']);

    await expect(
      updateManagedCategoryLabel(other.id, { name: '  science   fiction ', locale: 'en-US' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('caps assignments at three and stays idempotent and manual-preferred', async (ctx) => {
    if (!schemaReady) return ctx.skip();

    const recordId = await recordIdFor(1);
    const categories = [
      await createCategory('Category One'),
      await createCategory('Category Two'),
      await createCategory('Category Three'),
      await createCategory('Category Four'),
    ];

    await assignCategoryToSourceRecord(recordId, categories[0]!.id, 'manual');
    await assignCategoryToSourceRecord(recordId, categories[1]!.id, 'ai');
    await assignCategoryToSourceRecord(recordId, categories[2]!.id, 'ai');

    // Repeating an identical assignment is a no-op.
    await assignCategoryToSourceRecord(recordId, categories[0]!.id, 'manual');
    expect(await listAssignmentsForRecord(recordId)).toHaveLength(3);

    // A fourth net-new category is rejected; no existing row is removed.
    await expect(assignCategoryToSourceRecord(recordId, categories[3]!.id, 'manual')).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(await listAssignmentsForRecord(recordId)).toHaveLength(3);

    // Manual precedence: AI cannot override a manual row, manual promotes an AI row.
    await assignCategoryToSourceRecord(recordId, categories[0]!.id, 'ai');
    let assignments = await listAssignmentsForRecord(recordId);
    expect(assignments.find((row) => row.categoryId === categories[0]!.id)?.source).toBe('manual');

    await assignCategoryToSourceRecord(recordId, categories[1]!.id, 'manual');
    assignments = await listAssignmentsForRecord(recordId);
    expect(assignments.find((row) => row.categoryId === categories[1]!.id)?.source).toBe('manual');
  });

  it('suppresses any explicit removal and clears it only on manual re-add', async (ctx) => {
    if (!schemaReady) return ctx.skip();

    const recordId = await recordIdFor(2);
    const aiCategory = await createCategory('Suppressed Category');
    const manualCategory = await createCategory('Manual Suppressed Category');

    await assignCategoryToSourceRecord(recordId, aiCategory.id, 'ai');
    await assignCategoryToSourceRecord(recordId, manualCategory.id, 'manual');

    // Removing either provenance records the exact pair.
    await unassignCategoryFromSourceRecord(recordId, aiCategory.id);
    await unassignCategoryFromSourceRecord(recordId, manualCategory.id);

    const suppressions = await db
      .select()
      .from(sourceRecordPublicCategorySuppressionTable)
      .where(eq(sourceRecordPublicCategorySuppressionTable.sourceRecordId, recordId));
    expect(suppressions.map((row) => row.categoryId).sort()).toEqual([aiCategory.id, manualCategory.id].sort());

    // A normal AI retry must not restore either exact removed pair.
    await assignCategoryToSourceRecord(recordId, aiCategory.id, 'ai');
    await assignCategoryToSourceRecord(recordId, manualCategory.id, 'ai');
    expect(await listAssignmentsForRecord(recordId)).toHaveLength(0);

    // An explicit manual request clears suppression and assigns.
    await assignCategoryToSourceRecord(recordId, aiCategory.id, 'manual');
    const assignments = await listAssignmentsForRecord(recordId);
    expect(assignments).toEqual([
      expect.objectContaining({ sourceRecordId: recordId, categoryId: aiCategory.id, source: 'manual' }),
    ]);

    const cleared = await db
      .select()
      .from(sourceRecordPublicCategorySuppressionTable)
      .where(eq(sourceRecordPublicCategorySuppressionTable.sourceRecordId, recordId));
    expect(cleared.map((row) => row.categoryId)).toEqual([manualCategory.id]);
  });

  it('localizes public list/detail and filters the record read model without leaking internals', async (ctx) => {
    if (!schemaReady) return ctx.skip();

    const recordId = await recordIdFor(1);
    const category = await createCategory('Public Projection');
    await updateManagedCategoryLabel(category.id, { name: '公开投影', locale: 'zh-CN' });
    await assignCategoryToSourceRecord(recordId, category.id, 'manual');

    const zhList = await listPublicCategories('zh-CN');
    expect(zhList.items.find((item) => item.id === category.id)).toMatchObject({
      name: '公开投影',
      recordCount: 1,
    });

    const enDetail = await getPublicCategory(category.id, 'en-US');
    expect(enDetail).toEqual({ id: category.id, name: 'Public Projection', recordCount: 1 });

    const managed = (await listManagedCategories()).find((item) => item.id === category.id);
    expect(managed?.meaning).toBeNull();
    expect(managed?.aliases).toEqual([]);

    const records = await listSourceRecords(
      sourceRecordListQuerySchema.parse({ categoryId: category.id, pageSize: 50 }),
      { locale: 'en-US' },
    );
    expect(records.items.map((item) => item.sourceRecordId)).toEqual([recordId]);
    for (const summary of records.items[0]!.categories ?? []) {
      expect(Object.keys(summary).sort()).toEqual(['id', 'name']);
    }
    expect(records.items[0]!.categories).toContainEqual({ id: category.id, name: 'Public Projection' });
  });

  it('serves a paginated admin view of one category assignments, including hidden records', async (ctx) => {
    if (!schemaReady) return ctx.skip();

    const recordId = await recordIdFor(1);
    const category = await createCategory('Admin Assignment View');
    await assignCategoryToSourceRecord(recordId, category.id, 'manual');

    const page = await listManagedCategorySourceRecords(
      category.id,
      categorySourceRecordListQuerySchema.parse({ pageSize: 1, q: 'Category Fixture 1' }),
      'en-US',
    );
    expect(page.items.map((item) => item.sourceRecordId)).toEqual([recordId]);
    expect(page.pagination).toMatchObject({ page: 1, pageSize: 1, total: 1 });
    expect(page.items[0]!.categories).toContainEqual({ id: category.id, name: 'Admin Assignment View' });
    for (const summary of page.items[0]!.categories ?? []) {
      expect(Object.keys(summary).sort()).toEqual(['id', 'name']);
    }

    // Instance management sees assignments even when the record is not publicly discoverable.
    await db.update(sourceRecordTable).set({ availability: 'unavailable' }).where(eq(sourceRecordTable.id, recordId));
    try {
      const hidden = await listManagedCategorySourceRecords(
        category.id,
        categorySourceRecordListQuerySchema.parse({ pageSize: 50 }),
        'en-US',
      );
      expect(hidden.items.map((item) => item.sourceRecordId)).toContain(recordId);

      const publicPage = await listSourceRecords(
        sourceRecordListQuerySchema.parse({ categoryId: category.id, pageSize: 50 }),
        { locale: 'en-US' },
      );
      expect(publicPage.items).toHaveLength(0);
    } finally {
      await db.update(sourceRecordTable).set({ availability: 'available' }).where(eq(sourceRecordTable.id, recordId));
    }

    await expect(
      listManagedCategorySourceRecords('missing-category', categorySourceRecordListQuerySchema.parse({}), 'en-US'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
