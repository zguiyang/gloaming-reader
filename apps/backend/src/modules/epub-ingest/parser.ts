import { registerParser } from '@/modules/content-parser/registry';
import type { ContentParser, ParsedContent } from '@/modules/content-parser/types';
import { EPUB_ERROR_CODES, EpubValidationError } from '@/modules/epub-ingest/archive/limits';
import { planChapters } from '@/modules/epub-ingest/chapters';
import { IMAGE_PLACEHOLDER_PREFIX, stripOrphanImagePlaceholders } from '@/modules/epub-ingest/normalization/images';
import { cleanXhtml } from '@/modules/epub-ingest/normalization/normalize-xhtml';
import { parseEpub } from '@/modules/epub-ingest/opf/parse';
import { epubParentDir, findEpubEntry, mimeForHref, resolveEpubAgainstBase } from '@/modules/epub-ingest/opf/paths';

/** Max HTML chars per chapter (abuse / runaway protection). */
const MAX_CHAPTER_HTML_CHARS = 1_500_000;

function imagePlaceholder(resolvedHref: string): string {
  return `${IMAGE_PLACEHOLDER_PREFIX}${Buffer.from(resolvedHref).toString('base64url')}__`;
}

/**
 * EPUB content parser — container parse → clean → chapter plan → unified
 * {@link ParsedContent}. Chapter HTML carries placeholder tokens for local
 * images; the orchestrator stores the bytes and rewrites the URLs.
 */
export const epubContentParser: ContentParser = {
  kind: 'admin_epub',

  async parse(bytes: Buffer): Promise<ParsedContent> {
    const book = await parseEpub(bytes);

    const placeholderToHref = new Map<string, string>();
    const chapters = planChapters(book, (href, rawHtml) => {
      const chapterDir = epubParentDir(href);
      const cleaned = cleanXhtml(rawHtml, (src) => {
        const resolved = resolveEpubAgainstBase(chapterDir, src);
        const token = imagePlaceholder(resolved);
        if (!placeholderToHref.has(token)) {
          placeholderToHref.set(token, resolved);
        }
        return token;
      });
      if (cleaned.html.length > MAX_CHAPTER_HTML_CHARS) {
        throw new EpubValidationError(
          EPUB_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED,
          `Chapter from ${href} exceeds ${MAX_CHAPTER_HTML_CHARS} chars`,
        );
      }
      return { title: '', html: cleaned.html, images: cleaned.images };
    });

    if (chapters.length === 0) {
      throw new EpubValidationError(EPUB_ERROR_CODES.INVALID_STRUCTURE, 'EPUB produced no readable chapters');
    }

    const images: ParsedContent['images'] = [];
    for (const [token, href] of placeholderToHref) {
      const imageBytes = findEpubEntry(book.entries, href);
      if (!imageBytes) continue;
      images.push({ token, href, mime: mimeForHref(href), bytes: imageBytes });
    }

    const keepTokens = new Set(images.map((image) => image.token));
    const resolvedChapters = chapters.map((chapter) => ({
      title: chapter.title,
      html: stripOrphanImagePlaceholders(chapter.html, keepTokens),
    }));

    let cover: ParsedContent['cover'] = null;
    if (book.coverHref) {
      const coverBytes = findEpubEntry(book.entries, book.coverHref);
      if (coverBytes) {
        cover = { bytes: coverBytes, mime: mimeForHref(book.coverHref), originalPath: book.coverHref };
      }
    }

    return {
      metadata: {
        title: book.title,
        authors: book.authors,
        description: book.description,
        language: book.language,
        subjects: book.subjects,
        sourceRaw: book.sourceRaw,
      },
      chapters: resolvedChapters,
      images,
      cover,
      stats: {
        spineCount: book.spine.length,
        navCount: book.nav.length,
        chapterCount: resolvedChapters.length,
      },
    };
  },
};

registerParser(epubContentParser);
