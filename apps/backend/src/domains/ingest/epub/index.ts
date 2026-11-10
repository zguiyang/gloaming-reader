export {
  EPUB_ERROR_CODES,
  EPUB_RESOURCE_LIMITS,
  EpubResourceLimitError,
  EpubValidationError,
  isEpubValidationError,
} from './archive/limits';
export type { ChapterPlan, SplitChapter } from './chapters';
export { planChapters, splitSingleFileByHeadings } from './chapters';
export { cleanBookTitle, cleanDescription, joinAuthors } from './metadata';
export { IMAGE_PLACEHOLDER_PREFIX, stripOrphanImagePlaceholders } from './normalization/images';
export { cleanXhtml } from './normalization/normalize-xhtml';
export { parseEpub } from './opf/parse';
export { metadataByLocalName, textOfDeep } from './opf/xml';
export { applyTextPipeline, fixDoubleEncodedEntities, normalizeWhitespace, removeEmptyTags } from './text-pipeline';
export type { ChapterImageRef, EpubBook } from './types';
