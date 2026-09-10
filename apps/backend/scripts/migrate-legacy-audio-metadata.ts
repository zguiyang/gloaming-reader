/**
 * Dry-run (default) metadata migration for historical audio assets.
 * Removes legacy segment objectKeys and timeline.storageKey from DB metadata.
 * Does not delete R2 objects.
 *
 * Usage:
 *   pnpm --filter @gloaming/backend exec tsx scripts/migrate-legacy-audio-metadata.ts
 *   ALLOW_LEGACY_AUDIO_METADATA_MIGRATION=1 pnpm --filter @gloaming/backend exec tsx scripts/migrate-legacy-audio-metadata.ts --execute
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { eq, or } from 'drizzle-orm';

import { contentAsset as contentAssetTable, type ContentAssetMeta } from '@gloaming/db';
import { isLegacyAudioSegmentKey } from '@gloaming/shared/assets';

import { db } from '../src/db/index.ts';
import { env } from '../src/lib/env.ts';
import { formalAudioObjectKeys } from '../src/modules/content-assets/service.ts';

const MIGRATION_ENV = 'ALLOW_LEGACY_AUDIO_METADATA_MIGRATION';
const FORBIDDEN_DB_NAME_PATTERN = /(prod|production|live)/i;
const ALLOWED_DATABASE_NAMES = new Set(['gloaming_test', 'gloaming_development', 'gloaming-development']);

type MigrationCandidate = {
  assetId: string;
  workId: string | null;
  partId: string | null;
  kind: string;
  chapterKey: string | null;
  removedObjectKeys: string[];
  removedTimelineKeys: string[];
  contentHash: string | null;
  beforeMetadataHash: string;
  afterMetadataHash: string;
  createdAt: string;
  mode: 'dry-run' | 'execute';
};

type MigrationManifest = {
  createdAt: string;
  mode: 'dry-run' | 'execute';
  databaseName: string;
  candidateCount: number;
  candidates: MigrationCandidate[];
  updatedAssetIds: string[];
  failed: Array<{ assetId: string; error: string }>;
};

function parseArgs(argv: string[]): { execute: boolean; manifestPath?: string } {
  const execute = argv.includes('--execute');
  const manifestFlag = argv.findIndex((arg) => arg === '--manifest');
  const manifestPath =
    manifestFlag >= 0 && argv[manifestFlag + 1] && !argv[manifestFlag + 1]!.startsWith('--')
      ? path.resolve(argv[manifestFlag + 1]!)
      : undefined;
  return { execute, manifestPath };
}

function databaseNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  } catch {
    throw new Error('Cannot parse database name from DATABASE_URL');
  }
}

function assertSafeDatabase(databaseName: string): void {
  if (!databaseName) {
    throw new Error('Database name is empty; refusing to continue');
  }
  if (FORBIDDEN_DB_NAME_PATTERN.test(databaseName)) {
    throw new Error(`Refusing to run against database "${databaseName}" because the name looks like production`);
  }
  if (!ALLOWED_DATABASE_NAMES.has(databaseName)) {
    throw new Error(
      `Refusing to run against database "${databaseName}". Allowed: ${[...ALLOWED_DATABASE_NAMES].join(', ')}`,
    );
  }
}

function metadataHash(meta: ContentAssetMeta): string {
  return createHash('sha256').update(JSON.stringify(meta), 'utf8').digest('hex');
}

function buildCandidate(
  row: typeof contentAssetTable.$inferSelect,
  mode: 'dry-run' | 'execute',
): MigrationCandidate | null {
  const meta = row.meta ?? {};
  const removedObjectKeys = (meta.objectKeys ?? []).filter((key) => isLegacyAudioSegmentKey(key));
  const removedTimelineKeys = (meta.timeline ?? [])
    .map((segment) => segment.storageKey)
    .filter((key): key is string => Boolean(key) && isLegacyAudioSegmentKey(key));
  if (removedObjectKeys.length === 0 && removedTimelineKeys.length === 0) {
    return null;
  }

  const nextMeta: ContentAssetMeta = {
    ...meta,
    objectKeys: formalAudioObjectKeys({ storageKey: row.storageKey, meta }).filter(
      (key) => key !== row.storageKey || !isLegacyAudioSegmentKey(key),
    ),
    timeline: (meta.timeline ?? []).map((segment) => {
      const { storageKey: _removed, ...timing } = segment;
      return timing;
    }),
  };

  return {
    assetId: row.id,
    workId: row.workId,
    partId: row.partId,
    kind: row.kind,
    chapterKey: row.storageKey,
    removedObjectKeys,
    removedTimelineKeys,
    contentHash: row.contentHash,
    beforeMetadataHash: metadataHash(meta),
    afterMetadataHash: metadataHash(nextMeta),
    createdAt: new Date().toISOString(),
    mode,
  };
}

function isActiveGeneration(row: typeof contentAssetTable.$inferSelect, now = new Date()): boolean {
  if (row.status !== 'generating') return false;
  if (!row.generationLeaseExpiresAt) return true;
  return row.generationLeaseExpiresAt.getTime() > now.getTime();
}

async function writeManifest(manifest: MigrationManifest, manifestPath?: string): Promise<string> {
  const target =
    manifestPath ??
    path.join(process.cwd(), 'tmp', `legacy-audio-metadata-migration-${manifest.createdAt.replace(/[:.]/g, '-')}.json`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return target;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const databaseName = databaseNameFromUrl(env.DATABASE_URL);
  assertSafeDatabase(databaseName);

  if (options.execute && process.env[MIGRATION_ENV] !== '1') {
    throw new Error(`Refusing --execute without ${MIGRATION_ENV}=1 (explicit operator consent)`);
  }

  const mode = options.execute ? 'execute' : 'dry-run';
  console.log(`[${mode}] target database=${databaseName}`);

  const rows = await db
    .select()
    .from(contentAssetTable)
    .where(or(eq(contentAssetTable.kind, 'audio_us'), eq(contentAssetTable.kind, 'audio_uk')));

  const candidates: MigrationCandidate[] = [];
  for (const row of rows) {
    const candidate = buildCandidate(row, mode);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  const manifest: MigrationManifest = {
    createdAt: new Date().toISOString(),
    mode,
    databaseName,
    candidateCount: candidates.length,
    candidates,
    updatedAssetIds: [],
    failed: [],
  };

  if (!options.execute) {
    const written = await writeManifest(manifest, options.manifestPath);
    console.log(`[DRY-RUN] candidates=${candidates.length} manifest=${written}`);
    return;
  }

  for (const candidate of candidates) {
    try {
      const [current] = await db
        .select()
        .from(contentAssetTable)
        .where(eq(contentAssetTable.id, candidate.assetId))
        .limit(1);
      if (!current) {
        manifest.failed.push({ assetId: candidate.assetId, error: 'asset missing at execute time' });
        continue;
      }
      if (metadataHash(current.meta ?? {}) !== candidate.beforeMetadataHash) {
        manifest.failed.push({ assetId: candidate.assetId, error: 'metadata changed since dry-run' });
        continue;
      }
      if (isActiveGeneration(current)) {
        manifest.failed.push({ assetId: candidate.assetId, error: 'active generation in progress' });
        continue;
      }

      const meta = current.meta ?? {};
      const nextMeta: ContentAssetMeta = {
        ...meta,
        objectKeys: formalAudioObjectKeys({ storageKey: current.storageKey, meta }),
        timeline: (meta.timeline ?? []).map((segment) => {
          const { storageKey: _removed, ...timing } = segment;
          return timing;
        }),
      };

      const [updated] = await db
        .update(contentAssetTable)
        .set({ meta: nextMeta })
        .where(eq(contentAssetTable.id, candidate.assetId))
        .returning({ id: contentAssetTable.id });

      if (!updated) {
        manifest.failed.push({
          assetId: candidate.assetId,
          error: 'update rejected (generation active or status changed)',
        });
        continue;
      }
      manifest.updatedAssetIds.push(updated.id);
    } catch (error) {
      manifest.failed.push({
        assetId: candidate.assetId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const written = await writeManifest(manifest, options.manifestPath);
  console.log(
    `[EXECUTE] updated=${manifest.updatedAssetIds.length} failed=${manifest.failed.length} manifest=${written}`,
  );
}

main().catch((error: unknown) => {
  console.error('migrate-legacy-audio-metadata failed:', error);
  process.exit(1);
});
