import { randomUUID } from 'node:crypto';

import { count, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  contentAsset as contentAssetTable,
  readingPart as readingPartTable,
  readingState as readingStateTable,
  readingWork as readingWorkTable,
  userLibraryItem as userLibraryItemTable,
  userTag as userTagTable,
} from '@gloaming/db';
import { discoverySource as discoverySourceTable, sourceRecord as sourceRecordTable } from '@gloaming/db/schema';

import { PROJECT_GUTENBERG_UPSERT_BATCH_SIZE } from '@/domains/discovery/gutenberg/constants';
import type { ParsedSourceRecord } from '@/domains/discovery/gutenberg/rdf-record';
import { ensureDiscoverySource, upsertSourceRecords } from '@/domains/discovery/sync/repository';
import { db } from '@/infra/db';

/** Bounded: 4 measured batches per pass, no theoretical batch-size tuning. */
const BOUNDED_BATCHES = 4;
const TARGET_BATCH_SIZE = PROJECT_GUTENBERG_UPSERT_BATCH_SIZE;

const runId = randomUUID();
const sourceKey = `benchmark_${runId}`;
const observedAt = new Date('2030-03-01T00:00:00.000Z');

let sourceId = '';
let verificationClient: pg.Client;
let forbiddenBaseline: Record<string, number> = {};

function benchmarkRecord(batch: number, index: number): ParsedSourceRecord {
  return {
    externalId: `${runId}-b${batch}-${index}`,
    title: `Benchmark record ${batch}/${index}`,
    authors: [
      { name: `Benchmark Author ${index}`, role: 'author' },
      { name: `Secondary Author ${index}`, role: 'author' },
    ],
    languages: ['en', 'fr'],
    description: `Synthetic local benchmark record ${batch}/${index} used to measure 500-row upsert throughput.`,
    rightsStatement: 'Public domain in the USA.',
    coverUrl: `https://example.test/${runId}/${batch}/${index}/cover.jpg`,
    contentCandidates: [
      {
        format: 'epub',
        url: `https://example.test/${runId}/${batch}/${index}.epub`,
        mimeType: 'epub',
        sizeBytes: 1_000_000 + index,
      },
      { format: 'html', url: `https://example.test/${runId}/${batch}/${index}.html` },
    ],
    sourceMeta: {
      subjects: ['Fiction', 'Benchmark', `Subject ${index % 50}`],
      bookshelves: ['Best Books Ever'],
      extra: { issued: '1998-06-01', publisher: 'Synthetic Fixture Press' },
    },
    sourceUpdatedAt: new Date(observedAt.getTime() - index * 1000),
  };
}

function benchmarkBatch(batch: number, size: number): ParsedSourceRecord[] {
  return Array.from({ length: size }, (_, index) => benchmarkRecord(batch, index));
}

async function forbiddenRowCounts(): Promise<Record<string, number>> {
  const [works, parts, assets, state, library, tags] = await Promise.all([
    db.select({ value: count() }).from(readingWorkTable),
    db.select({ value: count() }).from(readingPartTable),
    db.select({ value: count() }).from(contentAssetTable),
    db.select({ value: count() }).from(readingStateTable),
    db.select({ value: count() }).from(userLibraryItemTable),
    db.select({ value: count() }).from(userTagTable),
  ]);
  return {
    readingWork: Number(works[0]?.value ?? 0),
    readingPart: Number(parts[0]?.value ?? 0),
    contentAsset: Number(assets[0]?.value ?? 0),
    readingState: Number(state[0]?.value ?? 0),
    userLibraryItem: Number(library[0]?.value ?? 0),
    userTag: Number(tags[0]?.value ?? 0),
  };
}

async function ownedRowCount(): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(sourceRecordTable)
    .where(eq(sourceRecordTable.sourceId, sourceId));
  return Number(row?.value ?? 0);
}

const querySpy = vi.spyOn(pg.Client.prototype, 'query');

function recordedInsertStatements(): string[] {
  return querySpy.mock.calls
    .map((call) => {
      const first = call[0] as unknown;
      if (typeof first === 'string') {
        return first;
      }
      if (first && typeof first === 'object' && 'text' in (first as Record<string, unknown>)) {
        return String((first as { text: unknown }).text);
      }
      return '';
    })
    .filter((text) => /insert into "source_record"/i.test(text));
}

describe('DS-02 500-row upsert benchmark on gloaming_test', () => {
  beforeAll(async () => {
    const connectionString = process.env.TEST_DATABASE_URL;
    expect(connectionString).toBeTruthy();
    expect(new URL(connectionString!).pathname).toBe('/gloaming_test');
    verificationClient = new pg.Client({ connectionString });
    await verificationClient.connect();

    forbiddenBaseline = await forbiddenRowCounts();

    const source = await ensureDiscoverySource(sourceKey, 'gutenberg_rdf');
    sourceId = source.id;
  });

  afterAll(async () => {
    const deleted = await db
      .delete(sourceRecordTable)
      .where(eq(sourceRecordTable.sourceId, sourceId))
      .returning({ id: sourceRecordTable.id });
    await db.delete(discoverySourceTable).where(eq(discoverySourceTable.id, sourceId));
    querySpy.mockRestore();

    const [sourceLeft] = await db
      .select({ value: count() })
      .from(discoverySourceTable)
      .where(eq(discoverySourceTable.id, sourceId));
    const [recordsLeft] = await db
      .select({ value: count() })
      .from(sourceRecordTable)
      .where(eq(sourceRecordTable.sourceId, sourceId));
    console.log(
      `[benchmark cleanup] deletedRecords=${deleted.length} remainingSourceRows=${Number(sourceLeft?.value ?? 0)} remainingRecordRows=${Number(recordsLeft?.value ?? 0)}`,
    );
    await verificationClient?.end();
  });

  it('measures real 500-row upsert batches, statement behavior, RSS, and idempotency', async () => {
    expect(TARGET_BATCH_SIZE).toBe(500);

    const rssBefore = process.memoryUsage().rss;
    const heapBefore = process.memoryUsage().heapUsed;
    let peakRss = rssBefore;

    const batchReports: Array<{
      pass: number;
      batch: number;
      elapsedMs: number;
      recordsPerSecond: number;
      statements: number;
      transactionStatements: number;
    }> = [];

    for (const pass of [1, 2]) {
      for (let batch = 0; batch < BOUNDED_BATCHES; batch += 1) {
        const records = benchmarkBatch(batch, TARGET_BATCH_SIZE);
        querySpy.mockClear();

        const startedAt = performance.now();
        await upsertSourceRecords(sourceId, records, observedAt);
        const elapsedMs = performance.now() - startedAt;

        const inserts = recordedInsertStatements();
        const transactionStatements = querySpy.mock.calls
          .map((call) => String(call[0]))
          .filter((text) => /^(begin|commit|rollback)\b/i.test(text)).length;

        expect(inserts).toHaveLength(1);
        expect(inserts[0]).toMatch(/on conflict \("source_id", ?"external_id"\) do update/i);
        expect(transactionStatements).toBe(0);

        // Cross-connection read proves the batch is committed, not held in an open transaction.
        const expectedRows = pass === 1 ? (batch + 1) * TARGET_BATCH_SIZE : BOUNDED_BATCHES * TARGET_BATCH_SIZE;
        const visible = await verificationClient.query<{ value: string }>(
          'select count(*)::text as value from "source_record" where "source_id" = $1',
          [sourceId],
        );
        expect(Number(visible.rows[0]?.value)).toBe(expectedRows);

        peakRss = Math.max(peakRss, process.memoryUsage().rss);
        batchReports.push({
          pass,
          batch,
          elapsedMs: Number(elapsedMs.toFixed(2)),
          recordsPerSecond: Number(((TARGET_BATCH_SIZE / elapsedMs) * 1000).toFixed(1)),
          statements: inserts.length,
          transactionStatements,
        });
      }
    }

    const totalRows = BOUNDED_BATCHES * TARGET_BATCH_SIZE;
    expect(await ownedRowCount()).toBe(totalRows);

    const rssAfter = process.memoryUsage().rss;
    const heapAfter = process.memoryUsage().heapUsed;
    const firstPass = batchReports.filter((report) => report.pass === 1);
    const secondPass = batchReports.filter((report) => report.pass === 2);
    const firstPassMs = firstPass.reduce((sum, report) => sum + report.elapsedMs, 0);
    const secondPassMs = secondPass.reduce((sum, report) => sum + report.elapsedMs, 0);

    console.log(
      JSON.stringify(
        {
          benchmark: 'source_record 500-row upsert',
          target: 'gloaming_test@127.0.0.1:5433',
          boundedBatches: BOUNDED_BATCHES,
          rowsPerBatch: TARGET_BATCH_SIZE,
          totalRows,
          insertPass: {
            elapsedMs: Number(firstPassMs.toFixed(2)),
            rowsPerSecond: Number(((totalRows / firstPassMs) * 1000).toFixed(1)),
          },
          idempotentUpdatePass: {
            elapsedMs: Number(secondPassMs.toFixed(2)),
            rowsPerSecond: Number(((totalRows / secondPassMs) * 1000).toFixed(1)),
          },
          batches: batchReports,
          statementsPerBatch: 1,
          transactionsUsed: 0,
          rssBytes: { before: rssBefore, after: rssAfter, peak: peakRss, delta: rssAfter - rssBefore },
          heapUsedBytes: { before: heapBefore, after: heapAfter, delta: heapAfter - heapBefore },
        },
        null,
        2,
      ),
    );
  }, 300_000);

  it('creates no ReadingWork, ContentAsset, Library, ReadingState, or User Tag rows', async () => {
    expect(await forbiddenRowCounts()).toEqual(forbiddenBaseline);
  });
});
