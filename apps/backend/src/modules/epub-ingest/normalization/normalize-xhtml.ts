import * as cheerio from 'cheerio';

import {
  removeContentsBlocks,
  removeEmptyReadingChrome,
  removeNonDisplayableFigures,
} from '@/modules/epub-ingest/normalization/display-cleanup';
import { collectAndRewriteImages } from '@/modules/epub-ingest/normalization/images';
import { fixSelfClosingTags, removeDangerousTags, scrubAttributes } from '@/modules/epub-ingest/normalization/sanitize';
import { applyTextPipeline } from '@/modules/epub-ingest/text-pipeline';
import type { ChapterImageRef } from '@/modules/epub-ingest/types';
import { assignLeafParagraphOrdinals } from '@/modules/works/part-content/paragraph-identity';

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
