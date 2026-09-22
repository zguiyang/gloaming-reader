/** Internal EPUB ingest types — parsed container, navigation, chapters. */

export type EpubNavItem = {
  /** Display label from nav.xhtml / toc.ncx. */
  label: string;
  /** Normalized (no leading ./) href, without fragment. */
  href: string;
  /** Optional fragment (anchor) inside the target file. */
  fragment?: string;
  /** Depth in the navigation tree (1 = top level). */
  depth: number;
};

export type EpubSpineItem = {
  /** Normalized href of the spine content file. */
  href: string;
  /** EPUB2 NCX idref (unused after href resolution). */
  idref: string;
};

/** Parsed EPUB container — everything the ingest pipeline needs. */
export type EpubBook = {
  /** Normalized entry path (leading `./` and `/` stripped) → file bytes. */
  entries: Map<string, Buffer>;
  opfPath: string;
  title: string;
  authors: string[];
  description: string;
  language: string;
  /** `dc:subject` values (local-name tolerant, array expanded). */
  subjects: string[];
  /** Raw `dc:source` value (unmatched — matching happens in metadata-fill). */
  sourceRaw: string;
  spine: EpubSpineItem[];
  /** Navigation tree flattened in reading order (nav.xhtml preferred, NCX fallback). */
  nav: EpubNavItem[];
  /** Cover image href when resolvable (EPUB3 cover-image / EPUB2 meta cover / heuristic). */
  coverHref: string | null;
  coverMime: string | null;
};

export type ChapterImageRef = {
  /** Normalized href of the image file inside the zip. */
  href: string;
  mime: string;
};

/** One chapter after cleaning — the unit that becomes a ReadingPart. */
export type CleanedChapter = {
  title: string;
  html: string;
  /** Sorted unique image refs appearing in this chapter's HTML. */
  images: ChapterImageRef[];
};
