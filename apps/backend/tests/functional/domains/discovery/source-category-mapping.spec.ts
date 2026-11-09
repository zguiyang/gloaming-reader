import { randomUUID } from 'node:crypto';

import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { discoverySource, publicCategory, publicCategoryLabel, sourceRecord } from '@gloaming/db/schema';

import { applyPublicCategoryAssignments } from '@/domains/discovery/categories/classification-repository';
import { listAssignmentsForRecord } from '@/domains/discovery/categories/repository';
import {
  assignCategoryToSourceRecord,
  createManagedCategory,
  deleteManagedCategory,
  unassignCategoryFromSourceRecord,
} from '@/domains/discovery/categories/service';
import {
  confirmNewSourceCategory,
  confirmSourceCategoryMapping,
  getConfirmedSourceCategoryIds,
  getOrCreateSourceCategoryMapping,
  ignoreSourceCategoryMapping,
  reconcileSourceCategoryAssignments,
  runSourceCategoryReconciliationBatch,
  suggestSourceCategoryMapping,
} from '@/domains/discovery/categories/source-category-mapping';
import { db } from '@/infra/db';

const { ai } = vi.hoisted(() => ({ ai: vi.fn() }));
vi.mock('@/domains/ai', () => ({ invokeAi: (...args: unknown[]) => ai(...args) }));
const sourceId = randomUUID();
const categoryIds: string[] = [];
const suffix = randomUUID().slice(0, 8);
let categoryId = '';

beforeAll(async () => {
  await db
    .insert(discoverySource)
    .values({ id: sourceId, sourceKey: `mapping-test-${suffix}`, sourceType: 'gutenberg_rdf', enabled: true });
  const category = await createManagedCategory({ name: `Adventure ${suffix}`, locale: 'en-US' });
  categoryId = category.id;
  categoryIds.push(categoryId);
});
beforeEach(() => ai.mockReset());
afterAll(async () => {
  await db.delete(discoverySource).where(eq(discoverySource.id, sourceId));
  await db.delete(publicCategory).where(inArray(publicCategory.id, categoryIds));
});

describe('source category mapping', () => {
  it('deduplicates source values, requires confirmation and reuses without AI', async () => {
    const a = await getOrCreateSourceCategoryMapping(sourceId, ' Category: Adventure ');
    const b = await getOrCreateSourceCategoryMapping(sourceId, 'category: adventure');
    expect(a.id).toBe(b.id);
    expect(await getConfirmedSourceCategoryIds(sourceId, ['Category: Adventure'])).toEqual([]);
    ai.mockResolvedValueOnce({
      content: {
        outcome: 'reuse',
        categoryIds: [categoryId, categoryId],
        newName: null,
        meaning: null,
        rationale: 'matches',
      },
    });
    const proposed = await suggestSourceCategoryMapping(a.id, { enableThinking: true });
    expect(proposed.status).toBe('review');
    expect(ai.mock.calls[0][0].enableThinking).toBe(true);
    const current = await getOrCreateSourceCategoryMapping(sourceId, 'Category: Adventure');
    await confirmSourceCategoryMapping(a.id, current.revision, [categoryId, categoryId]);
    expect(await getConfirmedSourceCategoryIds(sourceId, ['category: adventure', 'CATEGORY: ADVENTURE'])).toEqual([
      categoryId,
    ]);
    expect((await suggestSourceCategoryMapping(a.id)).status).toBe('skipped');
    expect(ai).toHaveBeenCalledTimes(1);
  });
  it('holds unknown category for review', async () => {
    const mapping = await getOrCreateSourceCategoryMapping(sourceId, 'category: other');
    ai.mockResolvedValueOnce({
      content: { outcome: 'reuse', categoryIds: ['unknown'], newName: null, meaning: null, rationale: 'matches' },
    });
    const result = await suggestSourceCategoryMapping(mapping.id);
    expect(result).toMatchObject({ status: 'review', suggestion: { outcome: 'review', categoryIds: [] } });
    await expect(confirmSourceCategoryMapping(mapping.id, 0, [categoryId])).rejects.toMatchObject({ statusCode: 409 });
    await expect(confirmSourceCategoryMapping(mapping.id, 2, ['unknown'])).rejects.toMatchObject({ statusCode: 409 });
  });

  it('holds an exact existing name proposed as a new category for review', async () => {
    const mapping = await getOrCreateSourceCategoryMapping(sourceId, 'category: duplicate');
    ai.mockResolvedValueOnce({
      content: {
        outcome: 'create',
        categoryIds: [],
        newName: `Adventure ${suffix}`,
        meaning: 'a topic',
        rationale: 'create',
      },
    });
    const result = await suggestSourceCategoryMapping(mapping.id);
    expect(result).toMatchObject({ status: 'review', suggestion: { outcome: 'review', newName: null } });
  });

  it('requests a second review for proposed categories and leaves rejection pending review', async () => {
    const mapping = await getOrCreateSourceCategoryMapping(sourceId, 'category: new concept');
    ai.mockResolvedValueOnce({
      content: {
        outcome: 'create',
        categoryIds: [],
        newName: `New concept ${suffix}`,
        meaning: 'broad topic',
        rationale: 'new',
      },
    });
    ai.mockResolvedValueOnce({ content: { distinct: false, rationale: 'Already covered' } });
    const result = await suggestSourceCategoryMapping(mapping.id);
    expect(result).toMatchObject({ status: 'review', suggestion: { outcome: 'review', rationale: 'Already covered' } });
    expect(ai).toHaveBeenCalledTimes(2);
    const firstContext = JSON.parse(ai.mock.calls[0]![0].messages[1].content as string);
    const reviewContext = JSON.parse(ai.mock.calls[1]![0].messages[1].content as string);
    expect(firstContext.categories).toEqual(reviewContext.categories);
    expect(firstContext.categories).toContainEqual(
      expect.objectContaining({
        id: categoryId,
        names: expect.arrayContaining([`Adventure ${suffix}`]),
        aliases: expect.any(Array),
      }),
    );
    expect(firstContext.categories.find((candidate: { id: string }) => candidate.id === categoryId)).not.toHaveProperty(
      'manualLocales',
    );
  });

  it('holds new-category suggestions for review when meanings were omitted to fit the budget', async () => {
    const rows = Array.from({ length: 65 }, (_, index) => ({ id: randomUUID(), name: `Bounded ${suffix} ${index}` }));
    categoryIds.push(...rows.map((row) => row.id));
    await db
      .insert(publicCategory)
      .values(rows.map((row) => ({ id: row.id, createdBy: 'manual', meaning: 'Broad category meaning. '.repeat(12) })));
    await db.insert(publicCategoryLabel).values(
      rows.map((row) => ({
        id: randomUUID(),
        categoryId: row.id,
        locale: 'en-US',
        name: row.name,
        normalizedName: row.name.toLowerCase(),
        editedBy: 'manual',
      })),
    );
    try {
      const mapping = await getOrCreateSourceCategoryMapping(sourceId, `category: bounded ${suffix}`);
      ai.mockResolvedValueOnce({
        content: {
          outcome: 'create',
          categoryIds: [],
          newName: `Fresh ${suffix}`,
          meaning: 'A broad topic',
          rationale: 'Distinct',
        },
      });
      const result = await suggestSourceCategoryMapping(mapping.id);
      expect(result).toMatchObject({
        status: 'review',
        suggestion: {
          outcome: 'review',
          rationale: 'Category details were omitted to fit the input; creation requires manual review.',
        },
      });
      expect(ai).toHaveBeenCalledTimes(1);
      const context = JSON.parse(ai.mock.calls[0]![0].messages[1].content as string);
      expect(context.categoryMeaningsOmitted).toBe(true);
      expect(context.categories.length).toBeGreaterThanOrEqual(66);
    } finally {
      await db.delete(publicCategory).where(
        inArray(
          publicCategory.id,
          rows.map((row) => row.id),
        ),
      );
      categoryIds.splice(categoryIds.length - rows.length, rows.length);
    }
  });

  it('creates a reviewed category and confirms its mapping atomically', async () => {
    const mapping = await getOrCreateSourceCategoryMapping(sourceId, 'category: fresh topic');
    ai.mockResolvedValueOnce({
      content: {
        outcome: 'create',
        categoryIds: [],
        newName: `Fresh topic ${suffix}`,
        meaning: 'broad topic',
        rationale: 'new',
      },
    });
    ai.mockResolvedValueOnce({ content: { distinct: true, rationale: 'distinct' } });
    expect((await suggestSourceCategoryMapping(mapping.id)).status).toBe('review');
    const created = await confirmNewSourceCategory(mapping.id, 2, 'en-US');
    categoryIds.push(created.categoryId);
    expect(await getConfirmedSourceCategoryIds(sourceId, ['category: fresh topic'])).toEqual([created.categoryId]);
    await expect(confirmNewSourceCategory(mapping.id, 1, 'en-US')).rejects.toMatchObject({ statusCode: 409 });
  });

  it('does not overwrite a confirmation while an AI request is running', async () => {
    const mapping = await getOrCreateSourceCategoryMapping(sourceId, 'category: race');
    let release!: (value: unknown) => void;
    ai.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const pending = suggestSourceCategoryMapping(mapping.id);
    await vi.waitFor(() => expect(ai).toHaveBeenCalledTimes(1));
    const current = await getOrCreateSourceCategoryMapping(sourceId, mapping.sourceValue);
    await confirmSourceCategoryMapping(mapping.id, current.revision, [categoryId]);
    release({ content: { outcome: 'ignore', categoryIds: [], newName: null, meaning: null, rationale: 'ignore' } });
    expect(await pending).toEqual({ status: 'superseded' });
    expect(await getConfirmedSourceCategoryIds(sourceId, ['category: race'])).toEqual([categoryId]);
  });

  it('reconciles multiple supports and replaces assignments from Category shelves only', async () => {
    const recordId = randomUUID();
    const first = await getOrCreateSourceCategoryMapping(sourceId, `Category: support a ${suffix}`);
    const second = await getOrCreateSourceCategoryMapping(sourceId, `Category: support b ${suffix}`);
    await confirmSourceCategoryMapping(first.id, first.revision, [categoryId]);
    await confirmSourceCategoryMapping(second.id, second.revision, [categoryId]);
    await db.insert(sourceRecord).values({
      id: recordId,
      sourceId,
      externalId: recordId,
      title: 'test',
      authors: [],
      languages: ['en'],
      sourceMeta: { bookshelves: [first.sourceValue, second.sourceValue] },
      availability: 'available',
    });
    expect(await reconcileSourceCategoryAssignments(recordId)).toEqual([categoryId]);
    expect(await reconcileSourceCategoryAssignments(recordId)).toEqual([categoryId]);
    expect(await listAssignmentsForRecord(recordId)).toEqual([
      expect.objectContaining({ categoryId, source: 'source' }),
    ]);
    await db
      .update(sourceRecord)
      .set({ sourceMeta: { bookshelves: [second.sourceValue] } })
      .where(eq(sourceRecord.id, recordId));
    expect(await reconcileSourceCategoryAssignments(recordId)).toEqual([categoryId]);
    await unassignCategoryFromSourceRecord(recordId, categoryId);
    expect(await reconcileSourceCategoryAssignments(recordId)).toEqual([categoryId]);
    await assignCategoryToSourceRecord(recordId, categoryId, 'manual');
    await db
      .update(sourceRecord)
      .set({ sourceMeta: { bookshelves: [] } })
      .where(eq(sourceRecord.id, recordId));
    expect(await reconcileSourceCategoryAssignments(recordId)).toEqual([]);
    expect(await listAssignmentsForRecord(recordId)).toEqual([]);
  });

  it('preserves mapped support when a later AI result drops its original AI assignment', async () => {
    const recordId = randomUUID();
    const mapping = await getOrCreateSourceCategoryMapping(sourceId, `Category: ai support ${suffix}`);
    await confirmSourceCategoryMapping(mapping.id, mapping.revision, [categoryId]);
    await db.insert(sourceRecord).values({
      id: recordId,
      sourceId,
      externalId: recordId,
      title: 'test',
      authors: [],
      languages: ['en'],
      sourceMeta: { bookshelves: [mapping.sourceValue] },
      availability: 'available',
    });
    await assignCategoryToSourceRecord(recordId, categoryId, 'ai');
    await reconcileSourceCategoryAssignments(recordId);
    await applyPublicCategoryAssignments(recordId, [], { reconcileStaleAi: true });
    expect(await listAssignmentsForRecord(recordId)).toEqual([
      expect.objectContaining({ categoryId, source: 'source' }),
    ]);
    await db
      .update(sourceRecord)
      .set({ sourceMeta: { bookshelves: [] } })
      .where(eq(sourceRecord.id, recordId));
    expect(await reconcileSourceCategoryAssignments(recordId)).toEqual([]);
  });

  it('drops AI assignments when Category shelf support disappears', async () => {
    const recordId = randomUUID();
    const mapping = await getOrCreateSourceCategoryMapping(sourceId, `Category: source then ai ${suffix}`);
    await confirmSourceCategoryMapping(mapping.id, mapping.revision, [categoryId]);
    await db.insert(sourceRecord).values({
      id: recordId,
      sourceId,
      externalId: recordId,
      title: 'test',
      authors: [],
      languages: ['en'],
      sourceMeta: { bookshelves: [mapping.sourceValue] },
      availability: 'available',
    });
    await reconcileSourceCategoryAssignments(recordId);
    await applyPublicCategoryAssignments(recordId, [categoryId], { reconcileStaleAi: true });
    await db
      .update(sourceRecord)
      .set({ sourceMeta: { bookshelves: [] } })
      .where(eq(sourceRecord.id, recordId));
    expect(await reconcileSourceCategoryAssignments(recordId)).toEqual([]);
    expect(await listAssignmentsForRecord(recordId)).toEqual([]);
  });

  it('retries failed AI analysis and avoids concurrent duplicate calls', async () => {
    const mapping = await getOrCreateSourceCategoryMapping(sourceId, `failure ${suffix}`);
    ai.mockRejectedValueOnce(new Error('unavailable'));
    await expect(suggestSourceCategoryMapping(mapping.id)).rejects.toThrow('unavailable');
    const failed = await getOrCreateSourceCategoryMapping(sourceId, mapping.sourceValue);
    expect(failed).toMatchObject({ status: 'pending', lastError: 'analysis_failed' });
    let release!: (value: unknown) => void;
    ai.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const first = suggestSourceCategoryMapping(mapping.id);
    await vi.waitFor(() => expect(ai).toHaveBeenCalledTimes(2));
    expect(await suggestSourceCategoryMapping(mapping.id)).toEqual({ status: 'skipped' });
    release({ content: { outcome: 'ignore', categoryIds: [], newName: null, meaning: null, rationale: 'ignore' } });
    expect((await first).status).toBe('review');
    expect(ai).toHaveBeenCalledTimes(2);
  });

  it('schedules and resumes bounded reconciliation after mapping confirmation and ignore', async () => {
    const mapping = await getOrCreateSourceCategoryMapping(sourceId, `Category: batch ${suffix}`);
    const recordId = randomUUID();
    await db.insert(sourceRecord).values({
      id: recordId,
      sourceId,
      externalId: recordId,
      title: 'test',
      authors: [],
      languages: ['en'],
      sourceMeta: { bookshelves: [mapping.sourceValue] },
      availability: 'available',
    });
    await confirmSourceCategoryMapping(mapping.id, mapping.revision, [categoryId]);
    let pass = await runSourceCategoryReconciliationBatch(mapping.id, 2);
    for (let i = 0; i < 30 && pass.status === 'pending'; i++)
      pass = await runSourceCategoryReconciliationBatch(mapping.id, 2);
    expect(pass.status).toBe('completed');
    expect(await listAssignmentsForRecord(recordId)).toEqual([
      expect.objectContaining({ categoryId, source: 'source' }),
    ]);
    await ignoreSourceCategoryMapping(mapping.id, 1);
    let ignored = await runSourceCategoryReconciliationBatch(mapping.id, 100);
    if (ignored.status === 'pending') ignored = await runSourceCategoryReconciliationBatch(mapping.id, 100);
    expect(ignored.status).toBe('completed');
    expect(await listAssignmentsForRecord(recordId)).toEqual([]);
  });

  it('deletes a category that only has shelf mappings', async () => {
    const category = await createManagedCategory({ name: `Mapped only ${suffix}`, locale: 'en-US' });
    categoryIds.push(category.id);
    const mapping = await getOrCreateSourceCategoryMapping(sourceId, `Category: mapped only ${suffix}`);
    await confirmSourceCategoryMapping(mapping.id, mapping.revision, [category.id]);
    await deleteManagedCategory(category.id);
    categoryIds.pop();
  });

  it('passes bounded source evidence and honors failure retry', async () => {
    const mapping = await getOrCreateSourceCategoryMapping(sourceId, `evidence ${suffix}`);
    const recordId = randomUUID();
    await db.insert(sourceRecord).values({
      id: recordId,
      sourceId,
      externalId: recordId,
      title: 'Evidence title',
      authors: [],
      languages: ['en'],
      sourceMeta: { bookshelves: [mapping.sourceValue], summary: 'Evidence summary' },
      availability: 'available',
    });
    ai.mockResolvedValueOnce({
      content: { outcome: 'reuse', categoryIds: [categoryId], newName: null, meaning: null, rationale: 'match' },
    });
    await suggestSourceCategoryMapping(mapping.id);
    const message = ai.mock.calls[0]![0].messages[1].content as string;
    expect(JSON.parse(message).evidence).toEqual([
      expect.objectContaining({ title: 'Evidence title', summary: 'Evidence summary' }),
    ]);
  });

  it('rejects unsupported locales and mismatched category scripts', async () => {
    const mapping = await getOrCreateSourceCategoryMapping(sourceId, `locale ${suffix}`);
    ai.mockResolvedValueOnce({
      content: {
        outcome: 'create',
        categoryIds: [],
        newName: `English name ${suffix}`,
        meaning: 'topic',
        rationale: 'new',
      },
    });
    ai.mockResolvedValueOnce({ content: { distinct: true, rationale: 'distinct' } });
    await suggestSourceCategoryMapping(mapping.id);
    await expect(confirmNewSourceCategory(mapping.id, 2, 'fr-FR')).rejects.toMatchObject({ statusCode: 400 });
    await expect(confirmNewSourceCategory(mapping.id, 2, 'zh-CN')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('removes only stale mapping-owned rows after a confirmed mapping changes', async () => {
    const other = await createManagedCategory({ name: `Replacement ${suffix}`, locale: 'en-US' });
    categoryIds.push(other.id);
    const recordId = randomUUID();
    const mapping = await getOrCreateSourceCategoryMapping(sourceId, `Category: change ${suffix}`);
    await confirmSourceCategoryMapping(mapping.id, mapping.revision, [categoryId]);
    await db.insert(sourceRecord).values({
      id: recordId,
      sourceId,
      externalId: recordId,
      title: 'test',
      authors: [],
      languages: ['en'],
      sourceMeta: { bookshelves: [mapping.sourceValue] },
      availability: 'available',
    });
    await reconcileSourceCategoryAssignments(recordId);
    await confirmSourceCategoryMapping(mapping.id, 1, [other.id]);
    expect(await reconcileSourceCategoryAssignments(recordId)).toEqual([other.id]);
  });

  it('preserves all four mapped categories and permits a later manual assignment', async () => {
    const created = await Promise.all(
      Array.from({ length: 5 }, (_, i) => createManagedCategory({ name: `Many ${suffix} ${i}`, locale: 'en-US' })),
    );
    categoryIds.push(...created.map((row) => row.id));
    const mapping = await getOrCreateSourceCategoryMapping(sourceId, `Category: many ${suffix}`);
    await confirmSourceCategoryMapping(
      mapping.id,
      mapping.revision,
      created.slice(0, 4).map((row) => row.id),
    );
    const recordId = randomUUID();
    await db.insert(sourceRecord).values({
      id: recordId,
      sourceId,
      externalId: recordId,
      title: 'test',
      authors: [],
      languages: ['en'],
      sourceMeta: { bookshelves: [mapping.sourceValue] },
      availability: 'available',
    });
    expect(await reconcileSourceCategoryAssignments(recordId)).toHaveLength(4);
    await assignCategoryToSourceRecord(recordId, created[4]!.id, 'manual');
    expect(await listAssignmentsForRecord(recordId)).toHaveLength(5);
  });
});
