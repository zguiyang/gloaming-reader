/**
 * Clear legacy request-scoped contextExamples from dictionary_entry.
 *
 * Safety:
 * - Default is dry-run (report only).
 * - Real writes require `--execute` AND `ALLOW_DICTIONARY_CONTEXT_CLEANUP=1`.
 * - Refuses database names that look like production.
 * - Only updates rows whose context_examples array is non-empty.
 * - Never runs on application startup.
 *
 * Usage:
 *   pnpm --filter @gloaming/backend exec tsx scripts/clear-dictionary-context-examples.ts
 *   ALLOW_DICTIONARY_CONTEXT_CLEANUP=1 pnpm --filter @gloaming/backend exec tsx scripts/clear-dictionary-context-examples.ts --execute
 *   ALLOW_DICTIONARY_CONTEXT_CLEANUP=1 pnpm --filter @gloaming/backend exec tsx scripts/clear-dictionary-context-examples.ts --execute --word=serendipity
 */
import { sql } from 'drizzle-orm';
import Redis from 'ioredis';

import { dictionaryEntry as dictionaryEntryTable } from '@gloaming/db';

import { db } from '../src/db/index.ts';
import { env } from '../src/lib/env.ts';

const FORBIDDEN_DB_NAME_PATTERN = /(prod|production|live)/i;
const WORD_CACHE_PREFIX = 'gloaming:dictionary:v1:word:';

type CliOptions = {
  execute: boolean;
  word?: string;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { execute: false };
  for (const arg of argv) {
    if (arg === '--execute') {
      options.execute = true;
      continue;
    }
    if (arg.startsWith('--word=')) {
      const value = arg.slice('--word='.length).trim().toLowerCase();
      if (value) {
        options.word = value;
      }
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printUsage(): void {
  console.log(`Clear non-empty dictionary_entry.context_examples (legacy request context).

Default: dry-run
Execute: ALLOW_DICTIONARY_CONTEXT_CLEANUP=1 ... --execute
Optional: --word=<exact-word> to limit scope
`);
}

function databaseNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  } catch {
    throw new Error(`Cannot parse database name from DATABASE_URL`);
  }
}

function assertSafeDatabase(databaseName: string): void {
  if (!databaseName) {
    throw new Error('Database name is empty; refusing to continue');
  }
  if (FORBIDDEN_DB_NAME_PATTERN.test(databaseName)) {
    throw new Error(`Refusing to run against database "${databaseName}" because the name looks like production`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const databaseName = databaseNameFromUrl(env.DATABASE_URL);
  assertSafeDatabase(databaseName);

  const allowExecute = process.env.ALLOW_DICTIONARY_CONTEXT_CLEANUP === '1';
  if (options.execute && !allowExecute) {
    throw new Error('Refusing --execute without ALLOW_DICTIONARY_CONTEXT_CLEANUP=1 (explicit operator consent)');
  }

  const mode = options.execute ? 'EXECUTE' : 'DRY-RUN';
  console.log(`[${mode}] target database=${databaseName}`);
  if (options.word) {
    console.log(`[${mode}] scoped word=${options.word}`);
  }

  const whereClause = options.word
    ? sql`${dictionaryEntryTable.word} = ${options.word} AND jsonb_typeof(${dictionaryEntryTable.contextExamples}) = 'array' AND jsonb_array_length(${dictionaryEntryTable.contextExamples}) > 0`
    : sql`jsonb_typeof(${dictionaryEntryTable.contextExamples}) = 'array' AND jsonb_array_length(${dictionaryEntryTable.contextExamples}) > 0`;

  const candidates = await db
    .select({
      id: dictionaryEntryTable.id,
      word: dictionaryEntryTable.word,
      contextExamples: dictionaryEntryTable.contextExamples,
    })
    .from(dictionaryEntryTable)
    .where(whereClause);

  console.log(`[${mode}] rows with non-empty context_examples: ${candidates.length}`);
  for (const row of candidates.slice(0, 20)) {
    const count = Array.isArray(row.contextExamples) ? row.contextExamples.length : 0;
    console.log(`  - ${row.word} (${row.id}) examples=${count}`);
  }
  if (candidates.length > 20) {
    console.log(`  ... and ${candidates.length - 20} more`);
  }

  if (!options.execute) {
    console.log('[DRY-RUN] No changes written. Re-run with ALLOW_DICTIONARY_CONTEXT_CLEANUP=1 --execute to clear.');
    return;
  }

  if (candidates.length === 0) {
    console.log('[EXECUTE] Nothing to clear');
    return;
  }

  const updated = await db
    .update(dictionaryEntryTable)
    .set({
      contextExamples: [],
      updatedAt: new Date(),
    })
    .where(whereClause)
    .returning({ id: dictionaryEntryTable.id, word: dictionaryEntryTable.word });

  console.log(`[EXECUTE] cleared context_examples on ${updated.length} row(s)`);

  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await redis.connect();
    let deletedKeys = 0;
    for (const row of updated) {
      const key = `${WORD_CACHE_PREFIX}${encodeURIComponent(row.word)}`;
      deletedKeys += await redis.del(key);
    }
    console.log(`[EXECUTE] deleted ${deletedKeys} redis word cache key(s) for cleared rows`);
  } finally {
    await redis.quit().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error('clear-dictionary-context-examples failed:', error);
  process.exit(1);
});
