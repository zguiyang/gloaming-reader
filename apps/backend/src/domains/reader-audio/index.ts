export type { ReaderAudioConfig } from '@/domains/reader-audio/config';
export { resolveReaderAudioConfig } from '@/domains/reader-audio/config';
export type { ReaderAudioIdentity, ReaderAudioIdentityInput } from '@/domains/reader-audio/identity';
export {
  buildReaderAudioConfigFingerprint,
  buildReaderAudioIdentity,
  readerAudioScopeKey,
} from '@/domains/reader-audio/identity';
export type { SegmentClaim, SegmentRow } from '@/domains/reader-audio/repository';
export {
  claimSegmentGeneration,
  failSegmentGeneration,
  finalizeSegmentReady,
  findSegmentByIdentity,
  waitForSegmentReady,
} from '@/domains/reader-audio/repository';
export { readerAudioRoutes } from '@/domains/reader-audio/routes';
export type { ReaderAudioDerivedSegment } from '@/domains/reader-audio/segmenter';
export {
  deriveReaderAudioSegments,
  SEGMENT_MAX_CHARS,
  SEGMENT_PIPELINE_VERSION,
} from '@/domains/reader-audio/segmenter';
export {
  getReaderAudioManifest,
  getReaderAudioSegment,
  streamReaderAudioSegment,
} from '@/domains/reader-audio/service';
export type { ReaderAudioManifest, ReaderAudioSegment } from '@gloaming/shared/reader';
