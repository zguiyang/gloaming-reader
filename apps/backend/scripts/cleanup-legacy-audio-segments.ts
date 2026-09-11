/**
 * Dry-run (default) or explicit-execute cleanup for historical audio segment
 * objects under part-audio/.../seg/*.mp3.
 *
 * Usage:
 *   pnpm --filter @gloaming/backend exec tsx scripts/cleanup-legacy-audio-segments.ts
 *   pnpm --filter @gloaming/backend exec tsx scripts/cleanup-legacy-audio-segments.ts --manifest ./tmp/legacy-dry-run.json
 *   ALLOW_LEGACY_AUDIO_SEGMENT_CLEANUP=1 pnpm --filter @gloaming/backend exec tsx scripts/cleanup-legacy-audio-segments.ts \
 *     --execute --manifest ./tmp/legacy-dry-run.json --output ./tmp/legacy-execute.json --expected-bucket <exact-bucket-name>
 *
 * --manifest is dry-run output, or the approved dry-run input during --execute.
 * --output is required for --execute and must be a different path so the approved
 * dry-run manifest is not overwritten.
 *
 * Never deletes the whole bucket or an unconditional part-audio prefix.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { runLegacySegmentCleanup } from '../src/modules/asset-management/legacy-segment-cleanup.ts';
import { LEGACY_AUDIO_SEGMENT_CLEANUP_ENV } from '../src/modules/asset-management/legacy-segment-cleanup-guards.ts';

function parsePathFlag(argv: string[], flag: string): string | undefined {
  const index = argv.findIndex((arg) => arg === flag);
  return index >= 0 && argv[index + 1] && !argv[index + 1]!.startsWith('--')
    ? path.resolve(argv[index + 1]!)
    : undefined;
}

export function parseCleanupLegacyAudioSegmentArgs(argv: string[]) {
  const execute = argv.includes('--execute');
  const manifestPath = parsePathFlag(argv, '--manifest');
  const outputPath = parsePathFlag(argv, '--output');
  const expectedBucket = (() => {
    const bucketFlag = argv.findIndex((arg) => arg === '--expected-bucket');
    return bucketFlag >= 0 && argv[bucketFlag + 1] && !argv[bucketFlag + 1]!.startsWith('--')
      ? argv[bucketFlag + 1]!
      : undefined;
  })();
  const limitFlag = argv.findIndex((arg) => arg === '--limit');
  const limitRaw = limitFlag >= 0 ? argv[limitFlag + 1] : undefined;
  const objectLimit = limitRaw ? Number(limitRaw) : undefined;
  if (limitRaw !== undefined && (!Number.isFinite(objectLimit) || (objectLimit ?? 0) <= 0)) {
    throw new Error(`Invalid --limit value: ${limitRaw}`);
  }
  return { execute, manifestPath, outputPath, expectedBucket, objectLimit };
}

async function main() {
  const { execute, manifestPath, outputPath, expectedBucket, objectLimit } = parseCleanupLegacyAudioSegmentArgs(
    process.argv.slice(2),
  );
  if (execute) {
    console.error(
      `WARNING: --execute will delete eligible legacy segment objects after live revalidation (${LEGACY_AUDIO_SEGMENT_CLEANUP_ENV}=1, --manifest, --output, --expected-bucket required).`,
    );
  } else {
    console.error(
      'Dry-run mode (default). Pass --execute with approved --manifest and a separate --output to delete eligible keys.',
    );
  }

  const { manifest, manifestPath: written } = await runLegacySegmentCleanup({
    execute,
    manifestPath: execute ? undefined : manifestPath,
    approvedManifestPath: execute ? manifestPath : undefined,
    outputPath: execute ? outputPath : undefined,
    expectedBucket,
    objectLimit,
  });

  console.log(
    JSON.stringify(
      {
        mode: manifest.mode,
        targetBucket: manifest.targetBucket,
        scanComplete: manifest.scanComplete,
        listedSegmentCount: manifest.listedSegmentCount,
        eligibleCount: manifest.eligibleCount,
        eligibleBytes: manifest.eligibleBytes,
        skippedCount: manifest.skipped.length,
        deletedCount: manifest.deletedKeys.length,
        failedCount: manifest.failed.length,
        remainingEligibleCount: manifest.remainingEligibleCount,
        executedAt: manifest.executedAt,
        approvedManifestPath: execute ? manifestPath : undefined,
        manifestPath: written,
        eligibleKeys: manifest.eligibleKeys,
      },
      null,
      2,
    ),
  );

  if (manifest.failed.length > 0 || manifest.verification?.passed === false) {
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
  main().catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exit(1);
  });
}
