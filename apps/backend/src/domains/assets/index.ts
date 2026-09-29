export { concatMp3Buffers } from '@/domains/assets/audio/audio-concat';
export { enqueueWorkAudio } from '@/domains/assets/audio/generation';
export {
  allAudioObjectKeysForLegacyCleanup,
  collectLegacyAudioSegmentKeysFromAsset,
  formalAudioObjectKeys,
  partAudioChapterKey,
  partAudioObjectKey,
  partAudioSegmentKey,
} from '@/domains/assets/audio/keys';
export type { PartAudioGenerateInput } from '@/domains/assets/audio/part-audio-run';
export { runPartAudioGenerate } from '@/domains/assets/audio/part-audio-run';
export { splitForTts } from '@/domains/assets/audio/part-audio-split';
export type { AssetCleanupJobData } from '@/domains/assets/cleanup/job';
export { resolveCleanupTerminalStatus, runAssetCleanupJob } from '@/domains/assets/cleanup/job';
export type { CleanupJobRecord } from '@/domains/assets/cleanup/store';
export {
  CLEANUP_BATCH_SIZE,
  CLEANUP_LOCK_KEY,
  CLEANUP_LOCK_TTL_SECONDS,
  loadCleanupJob,
  saveCleanupJob,
} from '@/domains/assets/cleanup/store';
export { deleteAudioAssetObjects } from '@/domains/assets/content/audio/object-lifecycle';
export type { PartAudioAvailability } from '@/domains/assets/content/availability';
export { getPartAudioAvailability, needsRegen } from '@/domains/assets/content/availability';
export { getPartAudioTrackForActor } from '@/domains/assets/content/part-audio-track';
export type { ResolvedAsset } from '@/domains/assets/gateway/service';
export { isAssetAuthorized, isPublicAsset, resolveAsset, streamAsset } from '@/domains/assets/gateway/service';
export type { LockRenewalHandle } from '@/domains/assets/management/lock-store';
export { acquireLock, releaseLock, renewLock, startLockRenewal } from '@/domains/assets/management/lock-store';
export type { ReferencedKeyIndex } from '@/domains/assets/management/referenced-keys';
export {
  collectFormalKeysFromContentAssetRow,
  collectKeysFromOriginMeta,
  collectLegacySegmentKeysFromContentAssetRow,
  collectReferencedStorageKeys,
} from '@/domains/assets/management/referenced-keys';
export { assetManagementRoutes } from '@/domains/assets/routes/asset-management';
export { assetsRoutes } from '@/domains/assets/routes/assets';
export { SCAN_LOCK_KEY, SCAN_LOCK_TTL_SECONDS } from '@/domains/assets/scan/config';
export { reconcileObjects } from '@/domains/assets/scan/reconcile';
