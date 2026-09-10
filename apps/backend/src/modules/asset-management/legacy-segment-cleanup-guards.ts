import { isLegacyAudioSegmentKey } from '@gloaming/shared/assets';

export const LEGACY_AUDIO_SEGMENT_CLEANUP_ENV = 'ALLOW_LEGACY_AUDIO_SEGMENT_CLEANUP';

export type ApprovedLegacySegmentCleanupManifest = {
  createdAt: string;
  mode: 'dry-run' | 'execute';
  targetBucket: string;
  scanComplete: boolean;
  listedSegmentCount: number;
  eligibleKeys: string[];
  eligibleCount: number;
  eligibleBytes: number;
  referencedSkippedCount: number;
  skipped: Array<{ key: string; reason: string; detail?: string }>; // dry-run uses LegacySegmentSkipReason strings
  deletedKeys: string[];
  failed: Array<{ key: string; error: string }>;
};

export function assertLegacyCleanupExecuteAuthorized(execute: boolean): void {
  if (!execute) {
    return;
  }
  if (process.env[LEGACY_AUDIO_SEGMENT_CLEANUP_ENV] !== '1') {
    throw new Error(`Refusing --execute without ${LEGACY_AUDIO_SEGMENT_CLEANUP_ENV}=1 (explicit operator consent)`);
  }
}

export function assertLegacyCleanupExecuteArgs(options: {
  execute: boolean;
  approvedManifestPath?: string;
  expectedBucket?: string;
}): void {
  if (!options.execute) {
    return;
  }
  assertLegacyCleanupExecuteAuthorized(true);
  if (!options.approvedManifestPath) {
    throw new Error('Refusing --execute without --manifest <approved-manifest>');
  }
  if (!options.expectedBucket?.trim()) {
    throw new Error('Refusing --execute without --expected-bucket <exact-bucket-name>');
  }
}

export function validateApprovedLegacyCleanupManifest(
  manifest: ApprovedLegacySegmentCleanupManifest,
  expectedBucket: string,
  currentBucket: string,
): void {
  if (currentBucket !== expectedBucket) {
    throw new Error(`Refusing execute: runtime S3_BUCKET "${currentBucket}" !== --expected-bucket "${expectedBucket}"`);
  }
  if (manifest.targetBucket !== expectedBucket) {
    throw new Error(
      `Refusing execute: manifest targetBucket "${manifest.targetBucket}" !== --expected-bucket "${expectedBucket}"`,
    );
  }
  if (!manifest.scanComplete) {
    throw new Error('Refusing execute: manifest scanComplete is false');
  }
  if (manifest.mode !== 'dry-run') {
    throw new Error('Refusing execute: approved manifest must be from a dry-run scan');
  }
  if (manifest.eligibleKeys.some((key) => key.includes('*'))) {
    throw new Error('Refusing execute: manifest contains wildcard key');
  }
  for (const key of manifest.eligibleKeys) {
    if (!isLegacyAudioSegmentKey(key)) {
      throw new Error(`Refusing execute: manifest key is not a legacy segment: ${key}`);
    }
    if (key.endsWith('/chapter.mp3')) {
      throw new Error(`Refusing execute: manifest contains chapter key: ${key}`);
    }
  }
}
