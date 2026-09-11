import { createHash } from 'node:crypto';

import { isLegacyAudioSegmentKey } from '@gloaming/shared/assets';

export const LEGACY_AUDIO_SEGMENT_CLEANUP_ENV = 'ALLOW_LEGACY_AUDIO_SEGMENT_CLEANUP';

export type ApprovedLegacySegmentCleanupManifest = {
  createdAt: string;
  mode: 'dry-run' | 'execute';
  targetBucket: string;
  scanComplete: boolean;
  listedSegmentCount: number;
  eligibleKeys: string[];
  eligibleKeysFingerprint?: string;
  eligibleCount: number;
  eligibleBytes: number;
  referencedSkippedCount: number;
  skipped: Array<{ key: string; reason: string; detail?: string }>; // dry-run uses LegacySegmentSkipReason strings
  deletedKeys: string[];
  failed: Array<{ key: string; error: string }>;
  verification?: LegacySegmentCleanupVerification;
};

export type LegacySegmentCleanupVerification = {
  ran: boolean;
  deletedKeysStillPresent: string[];
  missingChapterKeys: string[];
  missingFormalAssetKeys: string[];
  passed: boolean;
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

export function computeLegacyCleanupEligibleKeysFingerprint(eligibleKeys: string[]): string {
  const sorted = [...eligibleKeys].toSorted();
  return createHash('sha256').update(JSON.stringify(sorted), 'utf8').digest('hex');
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
  if (manifest.eligibleCount !== manifest.eligibleKeys.length) {
    throw new Error('Refusing execute: manifest eligibleCount does not match eligibleKeys length');
  }
  if (new Set(manifest.eligibleKeys).size !== manifest.eligibleKeys.length) {
    throw new Error('Refusing execute: manifest eligibleKeys contains duplicates');
  }
  const skippedKeySet = new Set(manifest.skipped.map((entry) => entry.key));
  const overlap = manifest.eligibleKeys.filter((key) => skippedKeySet.has(key));
  if (overlap.length > 0) {
    throw new Error(`Refusing execute: manifest eligibleKeys overlap skipped keys: ${overlap.join(', ')}`);
  }
  if (
    manifest.eligibleKeysFingerprint &&
    manifest.eligibleKeysFingerprint !== computeLegacyCleanupEligibleKeysFingerprint(manifest.eligibleKeys)
  ) {
    throw new Error('Refusing execute: manifest eligibleKeysFingerprint does not match eligibleKeys');
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
