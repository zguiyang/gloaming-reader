/**
 * Dry-run (default) metadata migration for historical audio assets.
 * Removes legacy segment objectKeys and timeline.storageKey from DB metadata.
 * Does not delete R2 objects.
 *
 * Usage:
 *   pnpm --filter @gloaming/backend exec tsx scripts/migrate-legacy-audio-metadata.ts --manifest ./tmp/metadata-dry-run.json
 *   ALLOW_LEGACY_AUDIO_METADATA_MIGRATION=1 pnpm --filter @gloaming/backend exec tsx scripts/migrate-legacy-audio-metadata.ts \
 *     --execute --manifest ./tmp/metadata-dry-run.json --output ./tmp/metadata-execute.json
 *
 * --manifest is dry-run output, or the approved dry-run input during --execute.
 * --output is required for --execute and must be a different path so the approved
 * dry-run manifest is not overwritten.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { env } from '../src/lib/env.ts';
import { runLegacyMetadataMigration } from '../src/modules/asset-management/legacy-metadata-migration.ts';
import {
  assertMetadataMigrationExecuteArgs,
  assertSafeMetadataMigrationDatabase,
  databaseNameFromUrl,
} from '../src/modules/asset-management/legacy-metadata-migration-guards.ts';

export function parseMetadataMigrationArgs(argv: string[]): {
  execute: boolean;
  manifestPath?: string;
  outputPath?: string;
} {
  const execute = argv.includes('--execute');
  const manifestFlag = argv.findIndex((arg) => arg === '--manifest');
  const manifestPath =
    manifestFlag >= 0 && argv[manifestFlag + 1] && !argv[manifestFlag + 1]!.startsWith('--')
      ? path.resolve(argv[manifestFlag + 1]!)
      : undefined;
  const outputFlag = argv.findIndex((arg) => arg === '--output');
  const outputPath =
    outputFlag >= 0 && argv[outputFlag + 1] && !argv[outputFlag + 1]!.startsWith('--')
      ? path.resolve(argv[outputFlag + 1]!)
      : undefined;
  return { execute, manifestPath, outputPath };
}

async function main(): Promise<void> {
  const options = parseMetadataMigrationArgs(process.argv.slice(2));
  const databaseName = databaseNameFromUrl(env.DATABASE_URL);
  assertSafeMetadataMigrationDatabase(databaseName);
  assertMetadataMigrationExecuteArgs({
    execute: options.execute,
    approvedManifestPath: options.manifestPath,
    outputPath: options.outputPath,
  });

  const mode = options.execute ? 'execute' : 'dry-run';
  console.log(`[${mode}] target database=${databaseName}`);

  const { manifest, manifestPath } = await runLegacyMetadataMigration({
    execute: options.execute,
    databaseName,
    manifestPath: options.manifestPath,
    outputPath: options.outputPath,
  });

  console.log(
    JSON.stringify(
      {
        mode: manifest.mode,
        databaseName: manifest.databaseName,
        candidateCount: manifest.candidateCount,
        fingerprint: manifest.fingerprint,
        updatedCount: manifest.updatedAssetIds.length,
        skippedCount: manifest.skipped.length,
        conflictCount: manifest.conflicts.length,
        failedCount: manifest.failed.length,
        removedObjectKeyCount: manifest.removedObjectKeyCount,
        removedTimelineKeyCount: manifest.removedTimelineKeyCount,
        remainingLegacyReferences: manifest.remainingLegacyReferences,
        executedAt: manifest.executedAt,
        approvedManifestPath: options.execute ? options.manifestPath : undefined,
        manifestPath,
      },
      null,
      2,
    ),
  );

  if (manifest.failed.length > 0 || manifest.conflicts.length > 0) {
    process.exitCode = 1;
  }
}

function isDirectCliRun(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectCliRun()) {
  main().catch((error: unknown) => {
    console.error('migrate-legacy-audio-metadata failed:', error);
    process.exit(1);
  });
}
