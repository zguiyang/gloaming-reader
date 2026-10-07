import type { SourceRecordAuthor, SourceRecordContentCandidate, SourceRecordSourceMeta } from '@gloaming/db/schema';

/**
 * One Project Gutenberg RDF member mapped onto the current `source_record` schema.
 * This layer is metadata-only: no ReadingWork, ContentAsset, or Library side effects.
 */
export type ParsedSourceRecord = {
  externalId: string;
  title: string;
  authors: SourceRecordAuthor[];
  languages: string[];
  description: string | null;
  rightsStatement: string | null;
  coverUrl: string | null;
  contentCandidates: SourceRecordContentCandidate[];
  sourceMeta: SourceRecordSourceMeta;
  sourceUpdatedAt: Date | null;
};
