export type { EpubCandidateSource } from './epub-candidate';
export {
  EpubCandidateSelectionError,
  hasSelectableEpubCandidate,
  isOfficialGutenbergEpubUrl,
  resolveGutenbergEpubDownloadUrl,
  selectGutenbergEpubCandidate,
} from './epub-candidate';
export type { SourceRecordMaterializationErrorCode, SourceRecordMaterializationResult } from './service';
export { materializeSourceRecord, SourceRecordMaterializationError } from './service';
