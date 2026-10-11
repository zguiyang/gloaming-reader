import { randomUUID } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  discoverySource as discoverySourceTable,
  publicCategory as publicCategoryTable,
  publicCategoryLabel as publicCategoryLabelTable,
  publicClassificationBudget as publicClassificationBudgetTable,
  sourceRecord as sourceRecordTable,
  sourceRecordPublicCategorySuppression as suppressionTable,
} from '@gloaming/db/schema';

import {
  classifySourceRecordForPublicCategories,
  translateMissingPublicCategoryLabels,
} from '@/domains/discovery/categories/classification';
import {
  PUBLIC_CLASSIFICATION_BUDGET_ID,
  upsertAiCategoryLabel,
} from '@/domains/discovery/categories/classification-repository';
import { listAssignmentsForRecord } from '@/domains/discovery/categories/repository';
import {
  assignCategoryToSourceRecord,
  createManagedCategory,
  unassignCategoryFromSourceRecord,
  updateManagedCategoryLabel,
} from '@/domains/discovery/categories/service';
import { db } from '@/infra/db';

const { invokeAiMock, instanceProviderMock, acquireLockMock } = vi.hoisted(() => ({
  invokeAiMock: vi.fn(),
  instanceProviderMock: vi.fn(),
  acquireLockMock: vi.fn(),
}));

vi.mock('@/domains/ai', () => ({ invokeAi: (...args: unknown[]) => invokeAiMock(...args) }));

vi.mock('@/domains/provider-scope', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, resolveInstanceAppSettingValue: (...args: unknown[]) => instanceProviderMock(...args) };
});

vi.mock('@/infra/cache/lock', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    acquireLock: (...args: unknown[]) => acquireLockMock(...args),
    releaseLock: vi.fn().mockResolvedValue(undefined),
    startLockRenewal: vi.fn(() => ({ stop: vi.fn() })),
  };
});

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function aiResult<T>(content: T) {
  return {
    content,
    model: { rowId: 'mock', label: 'Mock', modelId: 'mock' },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  };
}

function reuseDecision(categoryIds: string[]) {
  return {
    outcome: 'REUSE',
    reuse: categoryIds.map((categoryId) => ({ categoryId, rationale: 'applies' })),
    create: [],
    reviewReason: null,
  };
}

function createDecision(name: string, meaning = 'a broad reusable concept') {
  return {
    outcome: 'CREATE',
    reuse: [],
    create: [{ name, meaning, reusable: true, distinctFromExisting: true, rationale: 'broad and reusable' }],
    reviewReason: null,
  };
}

const runId = randomUUID();
const suffix = runId.slice(0, 8);
const sourceKey = `pc03_classification_${runId}`;

let sourceId = '';
let budgetPreExisting: typeof publicClassificationBudgetTable.$inferSelect | null = null;
const createdCategoryIds = new Set<string>();

async function resetClassificationBudgetRow(): Promise<void> {
  await db
    .delete(publicClassificationBudgetTable)
    .where(eq(publicClassificationBudgetTable.id, PUBLIC_CLASSIFICATION_BUDGET_ID));
}

async function restoreClassificationBudgetRow(): Promise<void> {
  if (!budgetPreExisting) {
    await resetClassificationBudgetRow();
    return;
  }

  await db
    .insert(publicClassificationBudgetTable)
    .values({
      id: budgetPreExisting.id,
      quotaDate: budgetPreExisting.quotaDate,
      quotaUsed: budgetPreExisting.quotaUsed,
      quotaReserved: budgetPreExisting.quotaReserved,
      updatedAt: budgetPreExisting.updatedAt,
    })
    .onConflictDoUpdate({
      target: publicClassificationBudgetTable.id,
      set: {
        quotaDate: budgetPreExisting.quotaDate,
        quotaUsed: budgetPreExisting.quotaUsed,
        quotaReserved: budgetPreExisting.quotaReserved,
        updatedAt: budgetPreExisting.updatedAt,
      },
    });
}

async function createCategory(name: string, locale = 'en-US') {
  const category = await createManagedCategory({ name, locale });
  createdCategoryIds.add(category.id);
  return category;
}

async function insertRecord(overrides: Partial<typeof sourceRecordTable.$inferInsert> = {}) {
  const id = randomUUID();
  await db.insert(sourceRecordTable).values({
    id,
    sourceId,
    externalId: `${suffix}-${id.slice(0, 8)}`,
    title: 'A Bounded Test Book',
    authors: [{ name: 'Test Author' }],
    languages: ['en-US'],
    description: 'A short bounded description about distant worlds.',
    sourceMeta: { subjects: ['Space'], bookshelves: ['Science'] },
    availability: 'available',
    ...overrides,
  });
  return id;
}

async function invocations() {
  return invokeAiMock.mock.calls.length;
}

describe('public classification service on gloaming_test', () => {
  beforeAll(async () => {
    const [budgetRow] = await db
      .select()
      .from(publicClassificationBudgetTable)
      .where(eq(publicClassificationBudgetTable.id, PUBLIC_CLASSIFICATION_BUDGET_ID))
      .limit(1);
    budgetPreExisting = budgetRow ?? null;

    sourceId = randomUUID();
    await db.insert(discoverySourceTable).values({
      id: sourceId,
      sourceKey,
      sourceType: 'gutenberg_rdf',
      enabled: true,
    });
  });

  beforeEach(async () => {
    invokeAiMock.mockReset();
    instanceProviderMock.mockReset().mockResolvedValue('instance-model');
    acquireLockMock.mockReset().mockResolvedValue(true);
    await resetClassificationBudgetRow();
  });

  afterAll(async () => {
    try {
      await db.delete(sourceRecordTable).where(eq(sourceRecordTable.sourceId, sourceId));
      await db.delete(discoverySourceTable).where(eq(discoverySourceTable.id, sourceId));
      if (createdCategoryIds.size > 0) {
        await db.delete(publicCategoryTable).where(inArray(publicCategoryTable.id, [...createdCategoryIds]));
      }
    } finally {
      await restoreClassificationBudgetRow();
    }
  });

  it('reuses a cross-language equivalent stable id without creating a duplicate', async () => {
    const primary = await createCategory(`Science Fiction ${suffix}`);
    await updateManagedCategoryLabel(primary.id, { name: `科幻小说 ${suffix}`, locale: 'zh-CN' });
    const recordId = await insertRecord();
    invokeAiMock.mockResolvedValueOnce(aiResult(reuseDecision([primary.id])));

    const result = await classifySourceRecordForPublicCategories(recordId);

    expect(result).toEqual({
      status: 'completed',
      outcome: 'REUSE',
      categoryIds: [primary.id],
      createdCategoryIds: [],
    });
    const assignments = await listAssignmentsForRecord(recordId);
    expect(assignments).toEqual([expect.objectContaining({ categoryId: primary.id, source: 'ai' })]);

    const request = invokeAiMock.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
      outputSchema: { safeParse: (value: unknown) => { success: boolean } };
    };
    const context = JSON.parse(request.messages.find((message) => message.role === 'user')!.content) as {
      publicCategories: Array<{
        id: string;
        names: Record<string, string>;
        aliases: unknown[];
        meaning: string | null;
      }>;
    };
    const candidate = context.publicCategories.find((item) => item.id === primary.id)!;
    expect(candidate.names['zh-CN']).toBe(`科幻小说 ${suffix}`);
    expect(Object.keys(candidate).sort()).toEqual(['aliases', 'id', 'meaning', 'names']);
    expect(JSON.stringify(context)).not.toContain('userTag');
  });

  it('assigns multiple existing categories for a combined topic', async () => {
    const categories = await Promise.all([
      createCategory(`Science Fiction ${suffix}`),
      createCategory(`Adventure ${suffix}`),
      createCategory(`Mystery ${suffix}`),
    ]);
    const recordId = await insertRecord();
    invokeAiMock.mockResolvedValueOnce(aiResult(reuseDecision(categories.map((category) => category.id))));

    const result = await classifySourceRecordForPublicCategories(recordId);

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    expect(result.outcome).toBe('REUSE');
    expect([...result.categoryIds].sort()).toEqual(categories.map((category) => category.id).sort());
    expect(await listAssignmentsForRecord(recordId)).toHaveLength(3);
  });

  it('creates one restrained new category when the vocabulary cannot cover the record', async () => {
    const recordId = await insertRecord();
    invokeAiMock.mockResolvedValueOnce(aiResult(createDecision(`Space Opera ${suffix}`)));

    const result = await classifySourceRecordForPublicCategories(recordId);

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    expect(result.outcome).toBe('CREATE');
    expect(result.createdCategoryIds).toHaveLength(1);
    const categoryId = result.createdCategoryIds[0]!;
    createdCategoryIds.add(categoryId);

    const [category] = await db.select().from(publicCategoryTable).where(eq(publicCategoryTable.id, categoryId));
    expect(category).toMatchObject({ createdBy: 'ai', sourceLocale: 'en-US', meaning: 'a broad reusable concept' });
    const [label] = await db
      .select()
      .from(publicCategoryLabelTable)
      .where(eq(publicCategoryLabelTable.categoryId, categoryId));
    expect(label).toMatchObject({ locale: 'en-US', name: `Space Opera ${suffix}`, editedBy: 'ai' });
    expect(await listAssignmentsForRecord(recordId)).toEqual([expect.objectContaining({ categoryId, source: 'ai' })]);
  });

  it('translates a newly created category after releasing the classification lock', async () => {
    const recordId = await insertRecord();
    invokeAiMock
      .mockResolvedValueOnce(aiResult(createDecision(`Auto Translated ${suffix}`)))
      .mockResolvedValueOnce(aiResult({ translations: [{ locale: 'zh-CN', name: `自动翻译 ${suffix}` }] }));

    const result = await classifySourceRecordForPublicCategories(recordId);

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    expect(result.createdCategoryIds).toHaveLength(1);
    const categoryId = result.createdCategoryIds[0]!;
    createdCategoryIds.add(categoryId);

    const labels = await db
      .select()
      .from(publicCategoryLabelTable)
      .where(eq(publicCategoryLabelTable.categoryId, categoryId));
    expect(labels.find((label) => label.locale === 'en-US')).toMatchObject({
      name: `Auto Translated ${suffix}`,
      editedBy: 'ai',
    });
    expect(labels.find((label) => label.locale === 'zh-CN')).toMatchObject({
      name: `自动翻译 ${suffix}`,
      editedBy: 'ai',
    });

    const translationRequest = invokeAiMock.mock.calls[1]?.[0] as { ref?: { type: string; id: string } };
    expect(translationRequest.ref).toEqual({ type: 'public_category', id: categoryId });
    expect(await invocations()).toBe(2);
  });

  it('keeps the completed classification and created category when translation fails', async () => {
    const recordId = await insertRecord();
    invokeAiMock
      .mockResolvedValueOnce(aiResult(createDecision(`Translation Fails ${suffix}`)))
      .mockRejectedValue(new Error('translation provider failed'));

    const result = await classifySourceRecordForPublicCategories(recordId);

    expect(result).toMatchObject({ status: 'completed', outcome: 'CREATE' });
    if (result.status !== 'completed') return;
    expect(result.createdCategoryIds).toHaveLength(1);
    const categoryId = result.createdCategoryIds[0]!;
    createdCategoryIds.add(categoryId);

    const [category] = await db.select().from(publicCategoryTable).where(eq(publicCategoryTable.id, categoryId));
    expect(category).toMatchObject({ createdBy: 'ai', sourceLocale: 'en-US' });
    const labels = await db
      .select()
      .from(publicCategoryLabelTable)
      .where(eq(publicCategoryLabelTable.categoryId, categoryId));
    expect(labels).toEqual([
      expect.objectContaining({ locale: 'en-US', name: `Translation Fails ${suffix}`, editedBy: 'ai' }),
    ]);
  });

  it('resolves an exact normalized name collision to the existing stable id', async () => {
    const existing = await createCategory(`Science Fiction ${suffix}`);
    const recordId = await insertRecord();
    invokeAiMock.mockResolvedValueOnce(aiResult(createDecision(`  science   fiction ${suffix} `)));

    const result = await classifySourceRecordForPublicCategories(recordId);

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    expect(result.createdCategoryIds).toEqual([]);
    expect(result.categoryIds).toEqual([existing.id]);
    const all = await db.select().from(publicCategoryTable);
    expect(all.filter((category) => category.id === existing.id)).toHaveLength(1);
  });

  it('caps and drops invalid model output before any write', async () => {
    const categories = await Promise.all([
      createCategory(`One ${suffix}`),
      createCategory(`Two ${suffix}`),
      createCategory(`Three ${suffix}`),
      createCategory(`Four ${suffix}`),
    ]);
    const recordId = await insertRecord();
    invokeAiMock.mockResolvedValueOnce(
      aiResult({
        outcome: 'REUSE',
        reuse: [
          ...categories.map((category) => ({ categoryId: category.id, rationale: 'r' })),
          { categoryId: 'does-not-exist', rationale: 'r' },
        ],
        create: [],
        reviewReason: null,
      }),
    );

    const result = await classifySourceRecordForPublicCategories(recordId);

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    expect(result.categoryIds).toHaveLength(3);
    expect(result.categoryIds).not.toContain('does-not-exist');
    const assignments = await listAssignmentsForRecord(recordId);
    expect(assignments).toHaveLength(3);
    expect(
      assignments.every((assignment) => categories.some((category) => category.id === assignment.categoryId)),
    ).toBe(true);
  });

  it('abstains when the model output cannot be applied', async () => {
    const recordId = await insertRecord();
    invokeAiMock.mockResolvedValueOnce(
      aiResult({
        outcome: 'CREATE',
        reuse: [],
        create: [
          { name: 'Bad\u202eName', meaning: 'unsafe', reusable: true, distinctFromExisting: true, rationale: 'r' },
        ],
        reviewReason: null,
      }),
    );

    const result = await classifySourceRecordForPublicCategories(recordId);

    expect(result).toEqual({ status: 'completed', outcome: 'NO_MATCH', categoryIds: [], createdCategoryIds: [] });
    expect(await listAssignmentsForRecord(recordId)).toHaveLength(0);
  });

  it('preserves manual assignments and the 0-3 cap', async () => {
    const manual = await Promise.all([
      createCategory(`Manual One ${suffix}`),
      createCategory(`Manual Two ${suffix}`),
      createCategory(`Manual Three ${suffix}`),
    ]);
    const extra = await createCategory(`Manual Four ${suffix}`);
    const recordId = await insertRecord();
    for (const category of manual) await assignCategoryToSourceRecord(recordId, category.id, 'manual');

    // AI may not add a fourth category, and re-proposing a manual row is a no-op.
    invokeAiMock.mockResolvedValueOnce(aiResult(reuseDecision([extra.id, manual[0]!.id])));
    const blocked = await classifySourceRecordForPublicCategories(recordId);
    expect(blocked.status).toBe('completed');
    const afterBlocked = await listAssignmentsForRecord(recordId);
    expect(afterBlocked).toHaveLength(3);
    expect(afterBlocked.find((row) => row.categoryId === manual[0]!.id)?.source).toBe('manual');
    expect(afterBlocked.some((row) => row.categoryId === extra.id)).toBe(false);
  });

  it('does not restore an explicitly removed pair on a normal AI retry', async () => {
    const category = await createCategory(`Suppressed ${suffix}`);
    const recordId = await insertRecord();
    await assignCategoryToSourceRecord(recordId, category.id, 'ai');
    await unassignCategoryFromSourceRecord(recordId, category.id);
    expect(await db.select().from(suppressionTable).where(eq(suppressionTable.sourceRecordId, recordId))).toHaveLength(
      1,
    );

    invokeAiMock.mockResolvedValueOnce(aiResult(reuseDecision([category.id])));
    const result = await classifySourceRecordForPublicCategories(recordId);

    expect(result.status).toBe('completed');
    expect(await listAssignmentsForRecord(recordId)).toHaveLength(0);
  });

  it('is idempotent across repeated runs', async () => {
    const category = await createCategory(`Repeatable ${suffix}`);
    const recordId = await insertRecord();
    invokeAiMock.mockResolvedValue(aiResult(reuseDecision([category.id])));

    await classifySourceRecordForPublicCategories(recordId);
    await classifySourceRecordForPublicCategories(recordId);

    const assignments = await listAssignmentsForRecord(recordId);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({ categoryId: category.id, source: 'ai' });
  });

  it('defers a concurrent task without duplicating work', async () => {
    const category = await createCategory(`Concurrent ${suffix}`);
    const recordId = await insertRecord();
    acquireLockMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    invokeAiMock.mockResolvedValue(aiResult(reuseDecision([category.id])));

    const [first, second] = await Promise.all([
      classifySourceRecordForPublicCategories(recordId),
      classifySourceRecordForPublicCategories(recordId),
    ]);

    expect(first).toMatchObject({ status: 'completed' });
    expect(second).toEqual({ status: 'deferred', reason: 'busy' });
    expect(await listAssignmentsForRecord(recordId)).toHaveLength(1);
  });

  it('defers when the instance provider is unavailable without calling AI', async () => {
    const recordId = await insertRecord();
    instanceProviderMock.mockResolvedValue(null);

    const result = await classifySourceRecordForPublicCategories(recordId);

    expect(result).toEqual({ status: 'deferred', reason: 'provider_unavailable' });
    expect(await invocations()).toBe(0);
    expect(await listAssignmentsForRecord(recordId)).toHaveLength(0);
  });

  it('defers when the shared daily budget is exhausted without calling AI', async () => {
    const recordId = await insertRecord();
    await db.insert(publicClassificationBudgetTable).values({
      id: PUBLIC_CLASSIFICATION_BUDGET_ID,
      quotaDate: utcDay(),
      quotaUsed: 50,
      quotaReserved: 0,
    });

    const result = await classifySourceRecordForPublicCategories(recordId);

    expect(result).toEqual({ status: 'deferred', reason: 'budget_unavailable' });
    expect(await invocations()).toBe(0);
  });

  it('retries a transient failure at most twice, then defers and can succeed later', async () => {
    const category = await createCategory(`Retry ${suffix}`);
    const recordId = await insertRecord();
    invokeAiMock
      .mockRejectedValueOnce(new Error('transient one'))
      .mockRejectedValueOnce(new Error('transient two'))
      .mockResolvedValueOnce(aiResult(reuseDecision([category.id])));

    const deferred = await classifySourceRecordForPublicCategories(recordId);
    expect(deferred).toEqual({ status: 'deferred', reason: 'transient_failure' });
    expect(await invocations()).toBe(2);
    const [budget] = await db.select().from(publicClassificationBudgetTable);
    expect(budget?.quotaUsed).toBe(2);

    const retried = await classifySourceRecordForPublicCategories(recordId);
    expect(retried).toMatchObject({ status: 'completed', outcome: 'REUSE' });
    expect(await listAssignmentsForRecord(recordId)).toHaveLength(1);
  });

  it('skips a missing or ineligible record', async () => {
    expect(await classifySourceRecordForPublicCategories(randomUUID())).toEqual({
      status: 'skipped',
      reason: 'source_record_not_found',
    });

    const unavailable = await insertRecord({ availability: 'unavailable' });
    expect(await classifySourceRecordForPublicCategories(unavailable)).toEqual({
      status: 'skipped',
      reason: 'source_record_not_eligible',
    });
  });

  it('never charges a user BYOK provider because no user id is ever passed', async () => {
    const recordId = await insertRecord();
    invokeAiMock.mockResolvedValueOnce(aiResult(reuseDecision([])));
    await classifySourceRecordForPublicCategories(recordId);

    const request = invokeAiMock.mock.calls[0]?.[0] as { userId?: string };
    expect(request.userId).toBeUndefined();
  });

  describe('label translation operation', () => {
    it('fills only the missing supported locales and leaves manual labels intact', async () => {
      const category = await createCategory(`Translatable ${suffix}`, 'en-US');
      invokeAiMock.mockResolvedValueOnce(aiResult({ translations: [{ locale: 'zh-CN', name: `可翻译 ${suffix}` }] }));

      const result = await translateMissingPublicCategoryLabels(category.id);

      expect(result).toEqual({ status: 'completed', categoryId: category.id, translatedLocales: ['zh-CN'] });
      const labels = await db
        .select()
        .from(publicCategoryLabelTable)
        .where(eq(publicCategoryLabelTable.categoryId, category.id));
      expect(labels.find((label) => label.locale === 'zh-CN')).toMatchObject({
        name: `可翻译 ${suffix}`,
        editedBy: 'ai',
      });
      expect(labels.find((label) => label.locale === 'en-US')).toMatchObject({ editedBy: 'manual' });
    });

    it('never overwrites a manually edited label even if automation tries', async () => {
      const category = await createCategory(`Protected ${suffix}`, 'en-US');
      await updateManagedCategoryLabel(category.id, { name: `受保护 ${suffix}`, locale: 'zh-CN' });
      const applied = await upsertAiCategoryLabel({
        categoryId: category.id,
        locale: 'zh-CN',
        name: `覆盖 ${suffix}`,
        normalizedName: `覆盖 ${suffix}`.normalize('NFC').trim().toLowerCase(),
      });
      expect(applied).toBe(false);
      const labels = await db
        .select()
        .from(publicCategoryLabelTable)
        .where(and(eq(publicCategoryLabelTable.categoryId, category.id), eq(publicCategoryLabelTable.locale, 'zh-CN')));
      expect(labels[0]).toMatchObject({ name: `受保护 ${suffix}`, editedBy: 'manual' });
    });

    it('skips when no locale is missing and defers when the provider is unavailable', async () => {
      const category = await createCategory(`Bilingual ${suffix}`, 'en-US');
      await updateManagedCategoryLabel(category.id, { name: `双语 ${suffix}`, locale: 'zh-CN' });
      expect(await translateMissingPublicCategoryLabels(category.id)).toEqual({
        status: 'skipped',
        reason: 'no_missing_locales',
      });

      const mono = await createCategory(`Mono ${suffix}`, 'en-US');
      instanceProviderMock.mockResolvedValue(null);
      expect(await translateMissingPublicCategoryLabels(mono.id)).toEqual({
        status: 'deferred',
        reason: 'provider_unavailable',
      });
    });

    it('does not block manual category creation when the provider is unavailable', async () => {
      instanceProviderMock.mockResolvedValue(null);
      const created = await createCategory(`Manual Unblocked ${suffix}`, 'zh-CN');
      expect(created.manualLocales).toEqual(['zh-CN']);
      expect(await invocations()).toBe(0);
    });
  });
});
