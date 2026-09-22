import * as cheerio from 'cheerio';

import {
  removeContentsBlocks,
  removeEmptyReadingChrome,
  removeNonDisplayableFigures,
} from '@/domains/ingest/epub/normalization/display-cleanup';
import { collectAndRewriteImages } from '@/domains/ingest/epub/normalization/images';
import { fixSelfClosingTags, removeDangerousTags, scrubAttributes } from '@/domains/ingest/epub/normalization/sanitize';
import { applyTextPipeline } from '@/domains/ingest/epub/text-pipeline';
import type { ChapterImageRef } from '@/domains/ingest/epub/types';
import { assignLeafParagraphOrdinals } from '@/domains/works';

export type CleanResult = {
  html: string;
  /** Sorted unique local image refs found in the cleaned HTML. */
  images: ChapterImageRef[];
};

/**
 * Clean one XHTML document into normalized reading HTML.
 * `rewriteImageSrc` maps a soft-normalized local href to its final URL (e.g.
 * the proxy asset path). Returns the cleaned fragment plus collected image refs.
 */
export function cleanXhtml(html: string, rewriteImageSrc: (href: string) => string): CleanResult {
  const $ = cheerio.load(fixSelfClosingTags(html.normalize('NFC')));

  removeDangerousTags($);
  scrubAttributes($);

  const images: ChapterImageRef[] = [];
  const seenImages = new Set<string>();
  collectAndRewriteImages($, rewriteImageSrc, images, seenImages);
  removeNonDisplayableFigures($);
  removeEmptyReadingChrome($);

  removeContentsBlocks($);
  assignLeafParagraphOrdinals($);

  const htmlOut = applyTextPipeline($('body').html() ?? $.root().html() ?? '');

  return { html: htmlOut.trim(), images };
}
