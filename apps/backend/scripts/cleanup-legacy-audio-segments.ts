/**
 * Dry-run (default) or explicit-execute cleanup for historical audio segment
 * objects under part-audio/.../seg/*.mp3.
 *
 * Usage:
 *   pnpm --filter @gloaming/backend exec tsx scripts/cleanup-legacy-audio-segments.ts
 *   pnpm --filter @gloaming/backend exec tsx scripts/cleanup-legacy-audio-segments.ts --manifest ./tmp/legacy.json
 *   ALLOW_LEGACY_AUDIO_SEGMENT_CLEANUP=1 pnpm --filter @gloaming/backend exec tsx scripts/cleanup-legacy-audio-segments.ts \
 *     --execute --manifest ./tmp/legacy.json --expected-bucket <exact-bucket-name>
 *
 * Never deletes the whole bucket or an unconditional part-audio prefix.
 */
import path from 'node:path';

import { runLegacySegmentCleanup } from '../src/modules/asset-management/legacy-segment-cleanup.ts';
import { LEGACY_AUDIO_SEGMENT_CLEANUP_ENV } from '../src/modules/asset-management/legacy-segment-cleanup-guards.ts';

function parseArgs(argv: string[]) {
  const execute = argv.includes('--execute');
  const manifestFlag = argv.findIndex((arg) => arg === '--manifest');
  const manifestPath =
    manifestFlag >= 0 && argv[manifestFlag + 1] && !argv[manifestFlag + 1]!.startsWith('--')
      ? path.resolve(argv[manifestFlag + 1]!)
      : undefined;
  const bucketFlag = argv.findIndex((arg) => arg === '--expected-bucket');
  const expectedBucket =
    bucketFlag >= 0 && argv[bucketFlag + 1] && !argv[bucketFlag + 1]!.startsWith('--')
      ? argv[bucketFlag + 1]!
      : undefined;
  const limitFlag = argv.findIndex((arg) => arg === '--limit');
  const limitRaw = limitFlag >= 0 ? argv[limitFlag + 1] : undefined;
  const objectLimit = limitRaw ? Number(limitRaw) : undefined;
  if (limitRaw !== undefined && (!Number.isFinite(objectLimit) || (objectLimit ?? 0) <= 0)) {
    throw new Error(`Invalid --limit value: ${limitRaw}`);
  }
  return { execute, manifestPath, expectedBucket, objectLimit };
}

async function main() {
  const { execute, manifestPath, expectedBucket, objectLimit } = parseArgs(process.argv.slice(2));
  if (execute) {
    console.error(
      `WARNING: --execute will delete eligible legacy segment objects after live revalidation (${LEGACY_AUDIO_SEGMENT_CLEANUP_ENV}=1, --manifest, --expected-bucket required).`,
    );
  } else {
    console.error('Dry-run mode (default). Pass --execute with approved manifest to delete eligible keys.');
  }

  const { manifest, manifestPath: written } = await runLegacySegmentCleanup({
    execute,
    manifestPath,
    approvedManifestPath: execute ? manifestPath : undefined,
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

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
