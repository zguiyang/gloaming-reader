import { createHash } from 'node:crypto';
import path from 'node:path';

import { isLegacyAudioSegmentKey } from '@gloaming/shared/assets';

export type LegacyMetadataMigrationCandidate = {
  assetId: string;
  workId: string | null;
  partId: string | null;
  kind: string;
  storageKey: string;
  contentHash: string;
  status: string;
  generationKey: string | null;
  generationToken: string | null;
  generationLeaseExpiresAt: string | null;
  chapterKey: string | null;
  removedObjectKeys: string[];
  removedTimelineKeys: string[];
  removedObjectKeyCount: number;
  removedTimelineKeyCount: number;
  beforeMetadataHash: string;
  afterMetadataHash: string;
};

export type LegacyMetadataMigrationManifest = {
  schemaVersion: number;
  toolVersion: string;
  createdAt: string;
  mode: 'dry-run' | 'execute';
  databaseName: string;
  candidateCount: number;
  fingerprint: string;
  removedObjectKeyCount: number;
  removedTimelineKeyCount: number;
  candidates: LegacyMetadataMigrationCandidate[];
  updatedAssetIds: string[];
  skipped: Array<{ assetId: string; reason: string }>;
  conflicts: Array<{ assetId: string; reason: string }>;
  failed: Array<{ assetId: string; error: string }>;
  remainingLegacyReferences: number;
  executedAt?: string;
};

export const LEGACY_AUDIO_METADATA_MIGRATION_ENV = 'ALLOW_LEGACY_AUDIO_METADATA_MIGRATION';
export const LEGACY_METADATA_MIGRATION_SCHEMA_VERSION = 1;
export const LEGACY_METADATA_MIGRATION_TOOL_VERSION = 'legacy-metadata-migration@1';

const FORBIDDEN_DB_NAME_PATTERN = /(prod|production|live)/i;
/** Exact database names permitted for metadata migration dry-run/execute. */
export const ALLOWED_METADATA_MIGRATION_DATABASE_NAMES = new Set([
  'gloaming_backend', // local Compose / `.env.example` development database
  'gloaming_test',
  'gloaming_development',
  'gloaming-development',
]);

export function databaseNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  } catch {
    throw new Error('Cannot parse database name from DATABASE_URL');
  }
}

export function assertSafeMetadataMigrationDatabase(databaseName: string): void {
  if (!databaseName) {
    throw new Error('Database name is empty; refusing to continue');
  }
  if (FORBIDDEN_DB_NAME_PATTERN.test(databaseName)) {
    throw new Error(`Refusing to run against database "${databaseName}" because the name looks like production`);
  }
  if (!ALLOWED_METADATA_MIGRATION_DATABASE_NAMES.has(databaseName)) {
    throw new Error(
      `Refusing to run against database "${databaseName}". Allowed: ${[...ALLOWED_METADATA_MIGRATION_DATABASE_NAMES].join(', ')}`,
    );
  }
}

export function assertMetadataMigrationExecuteAuthorized(execute: boolean): void {
  if (!execute) {
    return;
  }
  if (process.env[LEGACY_AUDIO_METADATA_MIGRATION_ENV] !== '1') {
    throw new Error(`Refusing --execute without ${LEGACY_AUDIO_METADATA_MIGRATION_ENV}=1 (explicit operator consent)`);
  }
}

export function assertDistinctManifestAndOutputPaths(manifestPath: string, outputPath: string): void {
  if (path.resolve(manifestPath) === path.resolve(outputPath)) {
    throw new Error('Refusing --execute: --output must be a different path from --manifest');
  }
}

export function assertMetadataMigrationExecuteArgs(options: {
  execute: boolean;
  approvedManifestPath?: string;
  outputPath?: string;
}): void {
  if (!options.execute) {
    return;
  }
  assertMetadataMigrationExecuteAuthorized(true);
  if (!options.approvedManifestPath) {
    throw new Error('Refusing --execute without --manifest <approved-dry-run-manifest>');
  }
  if (!options.outputPath?.trim()) {
    throw new Error('Refusing --execute without --output <execute-result-manifest>');
  }
  assertDistinctManifestAndOutputPaths(options.approvedManifestPath, options.outputPath);
}

export function computeMetadataMigrationFingerprint(candidates: LegacyMetadataMigrationCandidate[]): string {
  const payload = candidates
    .map((candidate) => ({
      assetId: candidate.assetId,
      beforeMetadataHash: candidate.beforeMetadataHash,
      afterMetadataHash: candidate.afterMetadataHash,
      contentHash: candidate.contentHash,
      storageKey: candidate.storageKey,
      status: candidate.status,
      generationToken: candidate.generationToken,
      generationKey: candidate.generationKey,
      removedObjectKeys: [...candidate.removedObjectKeys].toSorted(),
      removedTimelineKeys: [...candidate.removedTimelineKeys].toSorted(),
    }))
    .toSorted((left, right) => left.assetId.localeCompare(right.assetId));
  return createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

export function validateApprovedMetadataMigrationManifest(
  manifest: LegacyMetadataMigrationManifest,
  expectedDatabaseName: string,
): void {
  if (manifest.schemaVersion !== LEGACY_METADATA_MIGRATION_SCHEMA_VERSION) {
    throw new Error(
      `Refusing execute: manifest schemaVersion ${manifest.schemaVersion} !== ${LEGACY_METADATA_MIGRATION_SCHEMA_VERSION}`,
    );
  }
  if (manifest.mode !== 'dry-run') {
    throw new Error('Refusing execute: approved manifest must be from a dry-run scan');
  }
  if (manifest.databaseName !== expectedDatabaseName) {
    throw new Error(
      `Refusing execute: manifest databaseName "${manifest.databaseName}" !== current database "${expectedDatabaseName}"`,
    );
  }
  if (!manifest.fingerprint) {
    throw new Error('Refusing execute: manifest fingerprint is missing');
  }
  const recomputed = computeMetadataMigrationFingerprint(manifest.candidates);
  if (recomputed !== manifest.fingerprint) {
    throw new Error('Refusing execute: manifest fingerprint does not match candidate snapshot');
  }
  if (manifest.candidateCount !== manifest.candidates.length) {
    throw new Error('Refusing execute: manifest candidateCount does not match candidates length');
  }
  if (!Array.isArray(manifest.candidates) || (manifest.candidates.length === 0 && manifest.candidateCount > 0)) {
    throw new Error('Refusing execute: manifest candidates snapshot is missing');
  }

  for (const candidate of manifest.candidates) {
    if (!candidate.assetId || !candidate.beforeMetadataHash || !candidate.afterMetadataHash) {
      throw new Error(`Refusing execute: manifest candidate ${candidate.assetId || '<unknown>'} is incomplete`);
    }
    for (const key of candidate.removedObjectKeys) {
      if (!isLegacyAudioSegmentKey(key)) {
        throw new Error(`Refusing execute: manifest removedObjectKeys contains non-legacy key: ${key}`);
      }
      if (key.endsWith('/chapter.mp3')) {
        throw new Error(`Refusing execute: manifest contains chapter key in removedObjectKeys: ${key}`);
      }
    }
    for (const key of candidate.removedTimelineKeys) {
      if (!isLegacyAudioSegmentKey(key)) {
        throw new Error(`Refusing execute: manifest removedTimelineKeys contains non-legacy key: ${key}`);
      }
    }
    if (candidate.storageKey?.endsWith('/chapter.mp3') === false && candidate.storageKey?.includes('/seg/')) {
      throw new Error(`Refusing execute: manifest candidate storageKey looks like a segment: ${candidate.storageKey}`);
    }
  }
}
