export type { ReaderAudioConfig } from '@/server/domains/reader-audio/config';
export { resolveReaderAudioConfig } from '@/server/domains/reader-audio/config';
export type { ReaderAudioIdentity, ReaderAudioIdentityInput } from '@/server/domains/reader-audio/identity';
export {
  buildReaderAudioConfigFingerprint,
  buildReaderAudioIdentity,
  readerAudioScopeKey,
} from '@/server/domains/reader-audio/identity';
export type { SegmentClaim, SegmentRow, SegmentWaitResult } from '@/server/domains/reader-audio/repository';
export {
  claimSegmentGeneration,
  failSegmentGeneration,
  finalizeSegmentReady,
  findSegmentByIdentity,
  waitForSegmentReady,
} from '@/server/domains/reader-audio/repository';
export type { ReaderAudioDerivedSegment } from '@/server/domains/reader-audio/segmenter';
export {
  deriveReaderAudioSegments,
  SEGMENT_MAX_CHARS,
  SEGMENT_PIPELINE_VERSION,
} from '@/server/domains/reader-audio/segmenter';
export {
  getReaderAudioManifest,
  getReaderAudioSegment,
  streamReaderAudioSegment,
} from '@/server/domains/reader-audio/service';
export type { ReaderAudioManifest, ReaderAudioSegment } from '@gloaming/shared/reader';
