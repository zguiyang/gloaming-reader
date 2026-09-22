import type { WorkOriginKind } from '@gloaming/shared/works';

/** One resolved image referenced by a parsed chapter (deduped by token). */
export type ParsedImage = {
  /** Placeholder embedded in chapter HTML; the orchestrator replaces it with the asset URL. */
  token: string;
  /** Resolved source path inside the container (OPF-relative for EPUB). */
  href: string;
  mime: string;
  bytes: Buffer;
};

export type ParsedChapter = {
  title: string;
  /** Normalized reading HTML; local img srcs are placeholder tokens. */
  html: string;
};

export type ParsedContentMetadata = {
  title: string;
  authors: string[];
  description: string;
  language: string;
  /** `dc:subject` values (local-name tolerant, array expanded). */
  subjects: string[];
  /** Raw `dc:source` value (unmatched — matching happens in metadata-fill). */
  sourceRaw: string;
};

export type ParsedCover = {
  bytes: Buffer;
  mime: string;
  originalPath: string;
};

export type ParsedContentStats = {
  spineCount: number;
  navCount: number;
  chapterCount: number;
};

export type ParsedContent = {
  metadata: ParsedContentMetadata;
  chapters: ParsedChapter[];
  /** Unique tokens across the book; the orchestrator stores only referenced ones. */
  images: ParsedImage[];
  cover: ParsedCover | null;
  stats: ParsedContentStats;
};

/**
 * Strategy contract for content ingestion — one implementation per source
 * format (EPUB today, PDF later with completely different rules). Parsers own
 * format-specific parsing/cleaning/chaptering and return a source-agnostic
 * {@link ParsedContent}; the orchestrator owns storage + DB writes.
 */
export type ContentParser = {
  readonly kind: WorkOriginKind;
  parse(bytes: Buffer): Promise<ParsedContent>;
};
