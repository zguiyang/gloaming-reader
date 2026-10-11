import { randomUUID } from 'node:crypto';

import { and, eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  discoverySource as discoverySourceTable,
  publicCategory as publicCategoryTable,
  publicClassificationBudget as publicClassificationBudgetTable,
  sourceRecord as sourceRecordTable,
  sourceRecordPublicCategorySuppression as suppressionTable,
  sourceRecordPublicClassificationState as stateTable,
} from '@gloaming/db/schema';

import {
  processPublicClassification,
  type PublicClassificationJobData,
} from '@/application/jobs/public-classification';
import {
  computePublicClassificationFingerprint,
  dispatchDuePublicClassifications,
  recordPublicClassificationEvidenceBatch,
} from '@/domains/discovery/categories';
import { PUBLIC_CLASSIFICATION_BUDGET_ID } from '@/domains/discovery/categories/classification-repository';
import { listAssignmentsForRecord } from '@/domains/discovery/categories/repository';
import {
  assignCategoryToSourceRecord,
  createManagedCategory,
  unassignCategoryFromSourceRecord,
} from '@/domains/discovery/categories/service';
import { PROJECT_GUTENBERG_SOURCE_KEY, PROJECT_GUTENBERG_SOURCE_TYPE } from '@/domains/discovery/gutenberg/constants';
import type { ParsedSourceRecord } from '@/domains/discovery/gutenberg/rdf-record';
import { claimSourceQueued, ensureDiscoverySource, upsertSourceRecords } from '@/domains/discovery/sync/repository';
import { syncProjectGutenbergMetadata } from '@/domains/discovery/sync/service';
import { db } from '@/infra/db';

const { invokeAiMock, instanceProviderMock, acquireLockMock, enqueueMock } = vi.hoisted(() => ({
  invokeAiMock: vi.fn(),
  instanceProviderMock: vi.fn(),
  acquireLockMock: vi.fn(),
  enqueueMock: vi.fn(),
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

vi.mock('@/infra/queue', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, enqueuePublicClassification: (...args: unknown[]) => enqueueMock(...args) };
});

const snapshotMocks = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock('@/domains/discovery/gutenberg/snapshot-stream', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, openGutenbergSnapshot: snapshotMocks.open };
});

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

const runId = randomUUID();
const suffix = runId.slice(0, 8);
const sourceKey = `pc06_incremental_${runId}`;
const sourceType = 'gutenberg_rdf';

let sourceId = '';
let gutenbergSourceId = '';
let gutenbergPreExisting: typeof discoverySourceTable.$inferSelect | null = null;
const createdCategoryIds = new Set<string>();

/**
 * Preserve the pre-existing singleton budget row so this file only removes rows
 * it created and restores any budget state it found.
 */
let budgetPreExisting: typeof publicClassificationBudgetTable.$inferSelect | null = null;

/** Scoped reset of only the singleton budget row; never a table-wide delete. */
async function resetClassificationBudgetRow(): Promise<void> {
  await db
    .delete(publicClassificationBudgetTable)
    .where(eq(publicClassificationBudgetTable.id, PUBLIC_CLASSIFICATION_BUDGET_ID));
}

beforeAll(async () => {
  const [row] = await db
    .select()
    .from(publicClassificationBudgetTable)
    .where(eq(publicClassificationBudgetTable.id, PUBLIC_CLASSIFICATION_BUDGET_ID))
    .limit(1);
  budgetPreExisting = row ?? null;
});

afterAll(async () => {
  await resetClassificationBudgetRow();
  if (budgetPreExisting) {
    await db.insert(publicClassificationBudgetTable).values({
      id: budgetPreExisting.id,
      quotaDate: budgetPreExisting.quotaDate,
      quotaUsed: budgetPreExisting.quotaUsed,
      quotaReserved: budgetPreExisting.quotaReserved,
      updatedAt: budgetPreExisting.updatedAt,
    });
  }
});

function fixtureRecord(index: number, overrides: Partial<ParsedSourceRecord> = {}): ParsedSourceRecord {
  return {
    externalId: `${runId}-${index}`,
    title: `Incremental fixture ${index}`,
    authors: [{ name: `Incremental Author ${index}` }],
    languages: ['en-US'],
    description: 'A bounded description about distant worlds.',
    rightsStatement: null,
    coverUrl: null,
    contentCandidates: [{ format: 'epub', url: `https://example.test/${runId}/${index}.epub` }],
    sourceMeta: { subjects: ['Space'], bookshelves: ['Science'] },
    sourceUpdatedAt: null,
    ...overrides,
  };
}

function fixtureEvidence(record: ParsedSourceRecord) {
  return {
    title: record.title,
    authors: record.authors.map((author) => author.name),
    languages: record.languages,
    description: record.description,
    subjects: record.sourceMeta.subjects ?? [],
    bookshelves: record.sourceMeta.bookshelves ?? [],
  };
}

function fakeSnapshot(records: ParsedSourceRecord[], lastModified = 'Tue, 01 Jan 2030 00:00:00 GMT') {
  return {
    lastModified,
    records: (async function* () {
      for (const record of records) yield record;
    })(),
    close: vi.fn(),
  };
}

async function createCategory(name: string, locale = 'en-US') {
  const category = await createManagedCategory({ name: `${name} ${suffix}`, locale });
  createdCategoryIds.add(category.id);
  return category;
}

/** Insert one record directly and register fresh classification evidence (new record). */
async function insertAndRegister(record: ParsedSourceRecord): Promise<string> {
  const [{ id }] = await upsertSourceRecords(sourceId, [record], new Date());
  await recordPublicClassificationEvidenceBatch(
    [
      {
        sourceRecordId: id!,
        fingerprint: computePublicClassificationFingerprint(fixtureEvidence(record)),
        previousFingerprint: null,
        isNew: true,
      },
    ],
    new Date(),
  );
  return id!;
}

async function readState(sourceRecordId: string) {
  const [row] = await db.select().from(stateTable).where(eq(stateTable.sourceRecordId, sourceRecordId)).limit(1);
  return row ?? null;
}

async function readSource(sourceIdValue: string) {
  const [row] = await db.select().from(discoverySourceTable).where(eq(discoverySourceTable.id, sourceIdValue)).limit(1);
  return row ?? null;
}

/** Dispatch due rows, then run only the jobs belonging to the supplied record ids. */
async function dispatchAndRun(recordIds: Set<string>): Promise<{
  jobs: PublicClassificationJobData[];
  results: Array<Awaited<ReturnType<typeof processPublicClassification>>>;
}> {
  enqueueMock.mockReset();
  enqueueMock.mockImplementation(() => Promise.resolve('job'));
  await dispatchDuePublicClassifications(new Date(), 100);
  const jobs = (enqueueMock.mock.calls.map((call) => call[1]) as PublicClassificationJobData[]).filter((job) =>
    recordIds.has(job.sourceRecordId),
  );
  const results = [];
  for (const job of jobs) results.push(await processPublicClassification(job));
  return { jobs, results };
}

describe('incremental public classification on gloaming_test', () => {
  beforeAll(async () => {
    const source = await ensureDiscoverySource(sourceKey, sourceType);
    sourceId = source.id;
  });

  beforeEach(async () => {
    invokeAiMock.mockReset();
    instanceProviderMock.mockReset().mockResolvedValue('instance-model');
    acquireLockMock.mockReset().mockResolvedValue(true);
    enqueueMock.mockReset();
    await db.delete(sourceRecordTable).where(eq(sourceRecordTable.sourceId, sourceId));
    await resetClassificationBudgetRow();
  });

  afterAll(async () => {
    await db.delete(sourceRecordTable).where(eq(sourceRecordTable.sourceId, sourceId));
    await db.delete(discoverySourceTable).where(eq(discoverySourceTable.id, sourceId));
    if (createdCategoryIds.size > 0) {
      await db.delete(publicCategoryTable).where(inArray(publicCategoryTable.id, [...createdCategoryIds]));
    }
  });

  it('classifies a new record once, persists success per fingerprint, and keeps repeated sync free', async () => {
    const category = await createCategory('Space Opera');
    const record = fixtureRecord(1);
    const recordId = await insertAndRegister(record);
    const fingerprint = computePublicClassificationFingerprint(fixtureEvidence(record));
    invokeAiMock.mockResolvedValue(aiResult(reuseDecision([category.id])));

    const first = await dispatchAndRun(new Set([recordId]));
    expect(first.jobs).toHaveLength(1);
    expect(first.results).toEqual([{ status: 'completed' }]);
    expect(invokeAiMock).toHaveBeenCalledTimes(1);
    const completed = await readState(recordId);
    expect(completed).toMatchObject({ evidenceFingerprint: fingerprint, completedFingerprint: fingerprint });
    expect(await listAssignmentsForRecord(recordId)).toEqual([
      expect.objectContaining({ categoryId: category.id, source: 'ai' }),
    ]);

    // A repeated trigger with the same fingerprint must not enqueue or call AI again.
    const second = await dispatchAndRun(new Set([recordId]));
    expect(second.jobs).toHaveLength(0);
    expect(invokeAiMock).toHaveBeenCalledTimes(1);
  });

  it('re-triggers exactly once on a substantive metadata change', async () => {
    const category = await createCategory('Material Change');
    const original = fixtureRecord(2);
    const recordId = await insertAndRegister(original);
    invokeAiMock.mockResolvedValue(aiResult(reuseDecision([category.id])));
    await dispatchAndRun(new Set([recordId]));
    expect(invokeAiMock).toHaveBeenCalledTimes(1);

    // Same record, changed classification evidence (description + subjects).
    const changed = fixtureRecord(2, {
      description: 'A materially rewritten description about deep space travel.',
      sourceMeta: { subjects: ['Space', 'Exploration'], bookshelves: ['Science'] },
    });
    const previousFingerprint = computePublicClassificationFingerprint(fixtureEvidence(original));
    const [{ id }] = await upsertSourceRecords(sourceId, [changed], new Date());
    expect(id).toBe(recordId);
    await recordPublicClassificationEvidenceBatch(
      [
        {
          sourceRecordId: recordId,
          fingerprint: computePublicClassificationFingerprint(fixtureEvidence(changed)),
          previousFingerprint,
          isNew: false,
        },
      ],
      new Date(),
    );

    const state = await readState(recordId);
    expect(state?.completedFingerprint).toBeNull();
    invokeAiMock.mockResolvedValue(aiResult(reuseDecision([category.id])));
    const run = await dispatchAndRun(new Set([recordId]));
    expect(run.jobs).toHaveLength(1);
    expect(invokeAiMock).toHaveBeenCalledTimes(2);

    // Unchanged afterwards is free again.
    const repeated = await dispatchAndRun(new Set([recordId]));
    expect(repeated.jobs).toHaveLength(0);
    expect(invokeAiMock).toHaveBeenCalledTimes(2);
  });

  it('does not invoke AI again for a duplicate job on a completed fingerprint', async () => {
    const category = await createCategory('Duplicate Job');
    const record = fixtureRecord(3);
    const recordId = await insertAndRegister(record);
    invokeAiMock.mockResolvedValue(aiResult(reuseDecision([category.id])));
    const job: PublicClassificationJobData = {
      sourceRecordId: recordId,
      fingerprint: computePublicClassificationFingerprint(fixtureEvidence(record)),
    };

    expect(await processPublicClassification(job)).toEqual({ status: 'completed' });
    expect(await processPublicClassification(job)).toEqual({ status: 'skipped', reason: 'completed' });
    expect(invokeAiMock).toHaveBeenCalledTimes(1);
  });

  it('defers without calling AI when the provider is unavailable, then retries after the gate', async () => {
    const category = await createCategory('Provider Retry');
    const recordId = await insertAndRegister(fixtureRecord(4));
    instanceProviderMock.mockResolvedValue(null);

    const deferred = await dispatchAndRun(new Set([recordId]));
    expect(deferred.results).toEqual([{ status: 'deferred', reason: 'provider_unavailable' }]);
    expect(invokeAiMock).not.toHaveBeenCalled();
    const state = await readState(recordId);
    expect(state?.lastDeferredReason).toBe('provider_unavailable');
    expect(state?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    // Not due yet: the dispatcher must not create a rapid retry loop.
    const tooSoon = await dispatchAndRun(new Set([recordId]));
    expect(tooSoon.jobs).toHaveLength(0);

    // Provider returns and the gate passes: exactly one retry succeeds.
    instanceProviderMock.mockResolvedValue('instance-model');
    invokeAiMock.mockResolvedValue(aiResult(reuseDecision([category.id])));
    await db
      .update(stateTable)
      .set({ nextAttemptAt: new Date(Date.now() - 1_000) })
      .where(eq(stateTable.sourceRecordId, recordId));
    const retried = await dispatchAndRun(new Set([recordId]));
    expect(retried.results).toEqual([{ status: 'completed' }]);
    expect(invokeAiMock).toHaveBeenCalledTimes(1);
  });

  it('defers on budget exhaustion until the next UTC day, then becomes eligible', async () => {
    const category = await createCategory('Budget Rollover');
    const recordId = await insertAndRegister(fixtureRecord(5));
    const today = new Date().toISOString().slice(0, 10);
    await db.insert(publicClassificationBudgetTable).values({
      id: PUBLIC_CLASSIFICATION_BUDGET_ID,
      quotaDate: today,
      quotaUsed: 50,
      quotaReserved: 0,
    });

    const deferred = await dispatchAndRun(new Set([recordId]));
    expect(deferred.results).toEqual([{ status: 'deferred', reason: 'budget_unavailable' }]);
    expect(invokeAiMock).not.toHaveBeenCalled();
    const state = await readState(recordId);
    const nextMidnight = new Date();
    nextMidnight.setUTCHours(24, 1, 0, 0);
    expect(state?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(state?.nextAttemptAt.getUTCHours()).toBe(0);

    // Simulate the UTC date rollover: yesterday's quota no longer applies.
    await db
      .update(publicClassificationBudgetTable)
      .set({ quotaDate: '2000-01-01', quotaUsed: 50, quotaReserved: 0 })
      .where(eq(publicClassificationBudgetTable.id, PUBLIC_CLASSIFICATION_BUDGET_ID));
    await db
      .update(stateTable)
      .set({ nextAttemptAt: new Date(Date.now() - 1_000) })
      .where(eq(stateTable.sourceRecordId, recordId));
    invokeAiMock.mockResolvedValue(aiResult(reuseDecision([category.id])));

    const retried = await dispatchAndRun(new Set([recordId]));
    expect(retried.results).toEqual([{ status: 'completed' }]);
    expect(invokeAiMock).toHaveBeenCalledTimes(1);
  });

  it('caps one invocation at the PC-03 two AI attempts before deferring', async () => {
    const category = await createCategory('Max Attempts');
    const recordId = await insertAndRegister(fixtureRecord(6));
    invokeAiMock
      .mockRejectedValueOnce(new Error('transient one'))
      .mockRejectedValueOnce(new Error('transient two'))
      .mockResolvedValue(aiResult(reuseDecision([category.id])));

    const deferred = await dispatchAndRun(new Set([recordId]));
    expect(deferred.results).toEqual([{ status: 'deferred', reason: 'transient_failure' }]);
    expect(invokeAiMock).toHaveBeenCalledTimes(2);

    // A later eligible pass succeeds without any extra BullMQ-driven attempts.
    await db
      .update(stateTable)
      .set({ nextAttemptAt: new Date(Date.now() - 1_000) })
      .where(eq(stateTable.sourceRecordId, recordId));
    const retried = await dispatchAndRun(new Set([recordId]));
    expect(retried.results).toEqual([{ status: 'completed' }]);
    expect(invokeAiMock).toHaveBeenCalledTimes(3);
  });

  it('preserves manual assignments and never restores a suppressed pair', async () => {
    const manual = await Promise.all([
      createCategory('Manual One'),
      createCategory('Manual Two'),
      createCategory('Manual Three'),
    ]);
    const blocked = await createCategory('Manual Blocked');
    const manualRecordId = await insertAndRegister(fixtureRecord(7));
    for (const category of manual) await assignCategoryToSourceRecord(manualRecordId, category.id, 'manual');

    // AI may not add a fourth category and may not overwrite the manual rows.
    invokeAiMock.mockResolvedValue(aiResult(reuseDecision([blocked.id, manual[0]!.id])));
    const manualRun = await dispatchAndRun(new Set([manualRecordId]));
    expect(manualRun.results).toEqual([{ status: 'completed' }]);
    const preserved = await listAssignmentsForRecord(manualRecordId);
    expect(preserved).toHaveLength(3);
    expect(preserved.every((row) => row.source === 'manual')).toBe(true);
    expect(preserved.some((row) => row.categoryId === blocked.id)).toBe(false);

    // An explicitly removed AI pair stays suppressed on a later classification.
    const suppressedCategory = await createCategory('Suppressed Pair');
    const suppressedRecordId = await insertAndRegister(fixtureRecord(8));
    await assignCategoryToSourceRecord(suppressedRecordId, suppressedCategory.id, 'ai');
    await unassignCategoryFromSourceRecord(suppressedRecordId, suppressedCategory.id);
    expect(
      await db.select().from(suppressionTable).where(eq(suppressionTable.sourceRecordId, suppressedRecordId)),
    ).toHaveLength(1);

    invokeAiMock.mockResolvedValue(aiResult(reuseDecision([suppressedCategory.id])));
    const suppressedRun = await dispatchAndRun(new Set([suppressedRecordId]));
    expect(suppressedRun.results).toEqual([{ status: 'completed' }]);
    expect(await listAssignmentsForRecord(suppressedRecordId)).toHaveLength(0);
  });

  it('keeps enqueue failure and a failing classification job from touching SourceRecords', async () => {
    const recordId = await insertAndRegister(fixtureRecord(8));

    // Enqueue failure is swallowed by the dispatcher and leaves the row retryable.
    enqueueMock.mockReset();
    enqueueMock.mockRejectedValue(new Error('queue unavailable'));
    await expect(dispatchDuePublicClassifications()).resolves.toBeTypeOf('number');
    expect(await readState(recordId)).toMatchObject({ completedFingerprint: null });

    // A failing classification job never deletes the record or mutates assignments.
    invokeAiMock.mockRejectedValue(new Error('provider exploded'));
    await db
      .update(stateTable)
      .set({ nextAttemptAt: new Date(Date.now() - 1_000) })
      .where(eq(stateTable.sourceRecordId, recordId));
    const run = await dispatchAndRun(new Set([recordId]));
    expect(run.results).toEqual([{ status: 'deferred', reason: 'transient_failure' }]);
    expect(await db.select().from(sourceRecordTable).where(eq(sourceRecordTable.id, recordId))).toHaveLength(1);
    expect(await listAssignmentsForRecord(recordId)).toHaveLength(0);
  });
});

describe('Gutenberg sync incremental trigger on gloaming_test', () => {
  beforeAll(async () => {
    const [existing] = await db
      .select()
      .from(discoverySourceTable)
      .where(eq(discoverySourceTable.sourceKey, PROJECT_GUTENBERG_SOURCE_KEY))
      .limit(1);
    gutenbergPreExisting = existing ?? null;
    const source = await ensureDiscoverySource(PROJECT_GUTENBERG_SOURCE_KEY, PROJECT_GUTENBERG_SOURCE_TYPE);
    gutenbergSourceId = source.id;
  });

  beforeEach(async () => {
    snapshotMocks.open.mockReset();
    invokeAiMock.mockReset();
    instanceProviderMock.mockReset().mockResolvedValue('instance-model');
    acquireLockMock.mockReset().mockResolvedValue(true);
    enqueueMock.mockReset();
    await db
      .delete(sourceRecordTable)
      .where(and(eq(sourceRecordTable.sourceId, gutenbergSourceId), like(sourceRecordTable.externalId, `${runId}-%`)));
    await resetClassificationBudgetRow();
    await db
      .update(discoverySourceTable)
      .set({
        enabled: true,
        syncStatus: 'idle',
        syncStartedAt: null,
        syncFinishedAt: null,
        lastSuccessAt: null,
        lastErrorSummary: null,
        snapshotLastModified: null,
      })
      .where(eq(discoverySourceTable.id, gutenbergSourceId));
  });

  afterAll(async () => {
    await db
      .delete(sourceRecordTable)
      .where(and(eq(sourceRecordTable.sourceId, gutenbergSourceId), like(sourceRecordTable.externalId, `${runId}-%`)));
    if (gutenbergPreExisting) {
      await db
        .update(discoverySourceTable)
        .set({
          enabled: gutenbergPreExisting.enabled,
          syncStatus: gutenbergPreExisting.syncStatus,
          syncStartedAt: gutenbergPreExisting.syncStartedAt,
          syncFinishedAt: gutenbergPreExisting.syncFinishedAt,
          lastSuccessAt: gutenbergPreExisting.lastSuccessAt,
          lastErrorSummary: gutenbergPreExisting.lastErrorSummary,
          snapshotLastModified: gutenbergPreExisting.snapshotLastModified,
        })
        .where(eq(discoverySourceTable.id, gutenbergSourceId));
    }
  });

  it('triggers classification once for a new record and stays free on an unchanged sync', async () => {
    const category = await createCategory('Sync Trigger');
    const record = fixtureRecord(20);
    snapshotMocks.open.mockImplementation(async () => fakeSnapshot([record]));
    invokeAiMock.mockResolvedValue(aiResult(reuseDecision([category.id])));

    expect(await claimSourceQueued(gutenbergSourceId)).toBe(true);
    const firstSync = await syncProjectGutenbergMetadata();
    expect(firstSync).toMatchObject({ status: 'succeeded', seenRecords: 1 });

    const [recordRow] = await db
      .select()
      .from(sourceRecordTable)
      .where(
        and(eq(sourceRecordTable.sourceId, gutenbergSourceId), eq(sourceRecordTable.externalId, record.externalId)),
      )
      .limit(1);
    expect(recordRow).toBeDefined();
    const firstState = await readState(recordRow!.id);
    expect(firstState?.completedFingerprint).toBeNull();
    expect(firstState?.evidenceFingerprint).toBe(computePublicClassificationFingerprint(fixtureEvidence(record)));

    const run = await dispatchAndRun(new Set([recordRow!.id]));
    expect(run.results).toEqual([{ status: 'completed' }]);
    expect(invokeAiMock).toHaveBeenCalledTimes(1);

    // Second sync with identical evidence: no new due row and no AI call.
    await db
      .update(discoverySourceTable)
      .set({ syncStatus: 'idle', syncStartedAt: null })
      .where(eq(discoverySourceTable.id, gutenbergSourceId));
    expect(await claimSourceQueued(gutenbergSourceId)).toBe(true);
    const secondSync = await syncProjectGutenbergMetadata();
    expect(secondSync).toMatchObject({ status: 'succeeded', seenRecords: 1 });
    const second = await dispatchAndRun(new Set([recordRow!.id]));
    expect(second.jobs).toHaveLength(0);
    expect(invokeAiMock).toHaveBeenCalledTimes(1);
  });

  it('baselines a pre-existing unchanged record instead of reprocessing the corpus', async () => {
    const record = fixtureRecord(21);
    const [{ id }] = await upsertSourceRecords(gutenbergSourceId, [record], new Date());
    snapshotMocks.open.mockImplementation(async () => fakeSnapshot([record]));

    expect(await claimSourceQueued(gutenbergSourceId)).toBe(true);
    await syncProjectGutenbergMetadata();

    const state = await readState(id!);
    expect(state?.evidenceFingerprint).toBe(computePublicClassificationFingerprint(fixtureEvidence(record)));
    expect(state?.completedFingerprint).toBe(state?.evidenceFingerprint);
    const run = await dispatchAndRun(new Set([id!]));
    expect(run.jobs).toHaveLength(0);
    expect(invokeAiMock).not.toHaveBeenCalled();
  });

  it('keeps the sync successful and the record present when enqueue and classification fail', async () => {
    const record = fixtureRecord(22);
    snapshotMocks.open.mockResolvedValue(fakeSnapshot([record]));
    expect(await claimSourceQueued(gutenbergSourceId)).toBe(true);
    expect(await syncProjectGutenbergMetadata()).toMatchObject({ status: 'succeeded' });

    const [recordRow] = await db
      .select()
      .from(sourceRecordTable)
      .where(
        and(eq(sourceRecordTable.sourceId, gutenbergSourceId), eq(sourceRecordTable.externalId, record.externalId)),
      )
      .limit(1);
    expect(recordRow).toBeDefined();

    // Enqueue failure is swallowed by the dispatcher and stays retryable.
    enqueueMock.mockRejectedValue(new Error('queue down'));
    await expect(dispatchDuePublicClassifications()).resolves.toBeTypeOf('number');

    // Classification failure defers without touching the source or the record.
    invokeAiMock.mockRejectedValue(new Error('provider exploded'));
    await db
      .update(stateTable)
      .set({ nextAttemptAt: new Date(Date.now() - 1_000) })
      .where(eq(stateTable.sourceRecordId, recordRow!.id));
    const run = await dispatchAndRun(new Set([recordRow!.id]));
    expect(run.results).toEqual([{ status: 'deferred', reason: 'transient_failure' }]);

    const source = await readSource(gutenbergSourceId);
    expect(source?.syncStatus).toBe('succeeded');
    expect(source?.lastErrorSummary).toBeNull();
    expect(await db.select().from(sourceRecordTable).where(eq(sourceRecordTable.id, recordRow!.id))).toHaveLength(1);
  });
});
