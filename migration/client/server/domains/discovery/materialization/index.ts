export type { EpubCandidateSource } from './epub-candidate';
export {
  EpubCandidateSelectionError,
  hasSelectableEpubCandidate,
  isOfficialGutenbergEpubUrl,
  selectGutenbergEpubCandidate,
} from './epub-candidate';
export type { SourceRecordMaterializationErrorCode, SourceRecordMaterializationResult } from './service';
export { materializeSourceRecord, SourceRecordMaterializationError } from './service';
