/* eslint-disable @typescript-eslint/naming-convention -- fast-xml-parser attribute keys (@_*) are non-negotiable */
import * as cheerio from 'cheerio';

import { rootLogger } from '@/lib/logger';
import { EPUB_ERROR_CODES, EPUB_RESOURCE_LIMITS, EpubValidationError } from '@/modules/epub-ingest/archive/limits';
import { readZipEntries } from '@/modules/epub-ingest/archive/zip-reader';
import {
  findEntryCaseInsensitive,
  mimeForHref,
  normalizeHref,
  normalizeLanguage,
  resolveHref,
} from '@/modules/epub-ingest/opf/paths';
import {
  metadataByLocalName,
  metadataValuesByLocalName,
  parseXml,
  textOf,
  textOfDeep,
} from '@/modules/epub-ingest/opf/xml';

import type { EpubBook, EpubNavItem } from '../types';

const epubLogger = rootLogger.child({ module: 'EpubIngest' });

function rootfilePath(containerXml: Buffer): string | null {
  const doc = parseXml(containerXml.toString('utf8')) as { container?: { rootfiles?: unknown } };
  const rootfiles = doc.container?.rootfiles as { rootfile?: unknown } | undefined;
  let rootfile = rootfiles?.rootfile;
  if (Array.isArray(rootfile)) rootfile = rootfile[0];
  const href = (rootfile as { '@_full-path'?: string } | undefined)?.['@_full-path'];
  return href ? normalizeHref(href) : null;
}

function manifestItems(opf: Record<string, unknown>): Array<{
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
}> {
  const manifest = opf.manifest as { item?: unknown } | undefined;
  const items = manifest?.item;
  const list = Array.isArray(items) ? items : items ? [items] : [];
  return list.map((item) => {
    const row = item as Record<string, string>;
    return {
      id: row['@_id'] ?? '',
      href: normalizeHref(row['@_href'] ?? ''),
      mediaType: row['@_media-type'] ?? '',
      properties: row['@_properties'],
    };
  });
}

function spineItems(opf: Record<string, unknown>): Array<{ href: string; idref: string }> {
  const spine = opf.spine as { itemref?: unknown } | undefined;
  const refs = spine?.itemref;
  const list = Array.isArray(refs) ? refs : refs ? [refs] : [];
  return list.map((ref) => ({
    href: '',
    idref: (ref as { '@_idref'?: string })['@_idref'] ?? '',
  }));
}

function parseNavTree(navItems: unknown, depth = 1): EpubNavItem[] {
  const out: EpubNavItem[] = [];
  const items = Array.isArray(navItems) ? navItems : navItems ? [navItems] : [];
  for (const item of items) {
    const row = item as { navLabel?: unknown; content?: unknown; navPoint?: unknown };
    const label = row.navLabel as { text?: unknown } | undefined;
    const text = label?.text;
    const title = typeof text === 'string' ? text : textOf(text);
    const content = row.content as { '@_src'?: string } | undefined;
    const src = content?.['@_src'] ?? '';
    const [href, fragment] = src.split('#');
    const normalized = normalizeHref(href);
    if (title && normalized) {
      out.push({ label: title, href: normalized, fragment, depth });
    }
    out.push(...parseNavTree(row.navPoint, depth + 1));
  }
  return out;
}

function parseNavDocument(html: string): EpubNavItem[] {
  const $ = cheerio.load(html);
  const toc = $('nav[epub\\:type="toc"]').first();
  if (toc.length === 0) return [];
  const out: EpubNavItem[] = [];
  const walk = (ol: ReturnType<cheerio.CheerioAPI>, depth: number): void => {
    ol.children('li').each((_, li) => {
      const $li = $(li);
      const $a = $li.children('a').first();
      const label = $a.text().trim();
      const href = $a.attr('href') ?? '';
      const [path, fragment] = href.split('#');
      const normalized = normalizeHref(path);
      if (label && normalized) {
        out.push({ label, href: normalized, fragment, depth });
      }
      const nested = $li.children('ol').first();
      if (nested.length > 0) walk(nested, depth + 1);
    });
  };
  walk(toc.children('ol').first(), 1);
  return out;
}

function resolveCoverHref(
  pkg: Record<string, unknown>,
  manifest: Array<{ id: string; href: string; mediaType: string; properties?: string }>,
  entries: Map<string, Buffer>,
): string | null {
  // EPUB3: properties="cover-image".
  const epub3 = manifest.find((item) => item.properties?.split(/\s+/).includes('cover-image'));
  if (epub3) return epub3.href;

  // EPUB2: <meta name="cover" content="item-id"/>.
  const metas = pkg.metadata as { meta?: unknown } | undefined;
  const metaList = Array.isArray(metas?.meta) ? metas!.meta : metas?.meta ? [metas.meta] : [];
  for (const meta of metaList as Array<Record<string, string>>) {
    if (String(meta['@_name'] ?? '').toLowerCase() === 'cover') {
      const id = meta['@_content'];
      const item = manifest.find((m) => m.id === id);
      if (item) return item.href;
    }
  }

  // Heuristic: entry name contains cover/couv (raster only, mirroring foliate).
  const candidates = [...entries.keys()].filter(
    (key) => /cover|couv/i.test(key) && !key.toLowerCase().endsWith('.svg'),
  );
  if (candidates.length > 0) {
    candidates.sort((a, b) => a.length - b.length);
    return candidates[0]!;
  }
  return null;
}

/**
 * Parse an EPUB byte buffer into the container model:
 * entries, OPF metadata, spine, navigation (nav.xhtml → NCX), cover href.
 */
export async function parseEpub(buffer: Buffer, limits = EPUB_RESOURCE_LIMITS): Promise<EpubBook> {
  const entries = await readZipEntries(buffer, limits);
  try {
    const container = findEntryCaseInsensitive(entries, 'META-INF/container.xml');
    if (!container) {
      throw new EpubValidationError(EPUB_ERROR_CODES.INVALID_STRUCTURE, 'EPUB is missing META-INF/container.xml');
    }

    const opfPath = rootfilePath(container);
    if (!opfPath) {
      throw new EpubValidationError(EPUB_ERROR_CODES.INVALID_STRUCTURE, 'EPUB container.xml has no OPF rootfile');
    }

    const opfXml = findEntryCaseInsensitive(entries, opfPath);
    if (!opfXml) {
      throw new EpubValidationError(EPUB_ERROR_CODES.INVALID_STRUCTURE, `EPUB OPF not found: ${opfPath}`);
    }

    const opf = parseXml(opfXml.toString('utf8')) as { package?: Record<string, unknown> };
    const pkg = (opf.package ?? opf) as Record<string, unknown>;
    const metadata = (pkg.metadata ?? {}) as Record<string, unknown>;

    const title = textOfDeep(metadataByLocalName(metadata, 'title')).trim();

    const creators = metadataValuesByLocalName(metadata, 'creator');
    const authors = creators.map((c) => textOfDeep(c).trim()).filter(Boolean);

    const languageRaw = textOfDeep(metadataByLocalName(metadata, 'language'));
    const language = normalizeLanguage(languageRaw);

    const description = textOfDeep(metadataByLocalName(metadata, 'description')).trim();

    const subjects = metadataValuesByLocalName(metadata, 'subject')
      .map((s) => textOfDeep(s).trim())
      .filter(Boolean);

    const sourceRaw = textOfDeep(metadataByLocalName(metadata, 'source')).trim();

    // Manifest hrefs are relative to the OPF directory (e.g. "chapter-1.xhtml"
    // lives at "OEBPS/chapter-1.xhtml"); resolve before matching zip entries.
    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
    const resolve = (href: string): string => resolveHref(opfDir, href);

    const manifest = manifestItems(pkg).map((item) => ({ ...item, href: resolve(item.href) }));
    const idToHref = new Map(manifest.map((item) => [item.id, item.href]));
    const spine = spineItems(pkg)
      .map((item) => ({ href: idToHref.get(item.idref) ?? '', idref: item.idref }))
      .filter((item) => Boolean(item.href));

    if (spine.length === 0) {
      throw new EpubValidationError(EPUB_ERROR_CODES.INVALID_STRUCTURE, 'EPUB has an empty spine (no reading content)');
    }

    // Navigation: EPUB3 nav document first, EPUB2 NCX fallback.
    const navItem = manifest.find((item) => item.properties?.split(/\s+/).includes('nav'));
    let nav: EpubNavItem[] = [];
    if (navItem) {
      const navHtml = findEntryCaseInsensitive(entries, navItem.href);
      if (navHtml) {
        nav = parseNavDocument(navHtml.toString('utf8')).map((item) => ({
          ...item,
          href: resolve(item.href),
        }));
      }
    }
    if (nav.length === 0) {
      const spineToc = (pkg.spine as { '@_toc'?: string } | undefined)?.['@_toc'];
      const ncxHref = spineToc ? idToHref.get(spineToc) : null;
      const ncxEntry =
        (ncxHref && findEntryCaseInsensitive(entries, ncxHref)) ||
        findEntryCaseInsensitive(entries, 'toc.ncx') ||
        [...entries.entries()].find(([key]) => key.toLowerCase().endsWith('.ncx'))?.[1];
      if (ncxEntry) {
        const ncx = parseXml(ncxEntry.toString('utf8')) as { ncx?: { navMap?: unknown } };
        // NCX hrefs are relative to the OPF directory — resolve like nav.xhtml.
        nav = parseNavTree(ncx.ncx?.navMap).map((item) => ({ ...item, href: resolve(item.href) }));
      }
    }

    const coverHref = resolveCoverHref(pkg, manifest, entries);

    epubLogger.info(
      { title, authors: authors.join(', '), spineCount: spine.length, navCount: nav.length, coverHref },
      'EPUB parsed',
    );

    return {
      entries,
      opfPath,
      title,
      authors,
      description,
      language,
      subjects,
      sourceRaw,
      spine,
      nav,
      coverHref,
      coverMime: coverHref ? mimeForHref(coverHref) : null,
    };
  } catch (error) {
    if (error instanceof EpubValidationError) throw error;
    throw new EpubValidationError(
      EPUB_ERROR_CODES.INVALID_STRUCTURE,
      `EPUB structure could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
