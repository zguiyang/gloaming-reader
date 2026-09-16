/* eslint-disable @typescript-eslint/naming-convention -- fast-xml-parser attribute keys (@_*) are non-negotiable */
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { fromBuffer as yauzlFromBuffer } from 'yauzl';

import { EPUB_UPLOAD_MAX_BYTES } from '@gloaming/shared/works';

import { rootLogger } from '@/lib/logger';

import type { EpubBook, EpubNavItem } from './types';

const epubLogger = rootLogger.child({ module: 'EpubIngest' });

export const EPUB_ERROR_CODES = {
  INVALID_ARCHIVE: 'EPUB_INVALID_ARCHIVE',
  INVALID_STRUCTURE: 'EPUB_INVALID_STRUCTURE',
  RESOURCE_LIMIT_EXCEEDED: 'EPUB_RESOURCE_LIMIT_EXCEEDED',
} as const;

export const EPUB_RESOURCE_LIMITS = {
  maxCompressedBytes: EPUB_UPLOAD_MAX_BYTES,
  maxEntries: 10_000,
  maxSingleUncompressedBytes: 32 * 1024 * 1024,
  maxTotalUncompressedBytes: 128 * 1024 * 1024,
} as const;

export class EpubValidationError extends Error {
  constructor(
    public readonly code: (typeof EPUB_ERROR_CODES)[keyof typeof EPUB_ERROR_CODES],
    message: string,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'EpubValidationError';
  }
}

export class EpubResourceLimitError extends EpubValidationError {
  constructor(message: string) {
    super(EPUB_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED, message);
    this.name = 'EpubResourceLimitError';
  }
}

export function isEpubValidationError(error: unknown): error is EpubValidationError {
  return error instanceof EpubValidationError;
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

function decodePath(entry: string): string {
  try {
    return decodeURIComponent(entry);
  } catch {
    return entry;
  }
}

function normalizeHref(href: string): string {
  let result = decodePath(href.trim());
  while (result.startsWith('../')) result = result.slice(3);
  while (result.startsWith('./')) result = result.slice(2);
  result = result.replace(/^\/+/, '');
  return result.split('#')[0]!.trim();
}

/** Resolve a manifest href relative to the OPF directory. */
function resolveHref(opfDir: string, href: string): string {
  const normalized = normalizeHref(href);
  if (!opfDir || normalized.startsWith(opfDir + '/') || !normalized) return normalized;
  return normalizeHref(`${opfDir}/${normalized}`);
}

/**
 * Resolve a path relative to a zip directory (e.g. chapter folder), honoring
 * `../` segments. Unlike {@link normalizeHref}, does not strip leading `../`
 * before joining — needed for images referenced from nested spine files.
 */
function resolveAgainstBase(baseDir: string, href: string): string {
  const raw = decodePath(href.trim()).split('#')[0]!.trim();
  if (!raw) return '';
  const joined = [...(baseDir ? baseDir.split('/') : []), ...raw.split('/')];
  const stack: string[] = [];
  for (const part of joined) {
    if (!part || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join('/');
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx) : '';
}

/** Read zip entries with both metadata and actual streamed byte limits. */
function readZipEntries(buffer: Buffer, limits: typeof EPUB_RESOURCE_LIMITS): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    if (buffer.length > limits.maxCompressedBytes) {
      reject(new EpubResourceLimitError(`compressed EPUB exceeds ${limits.maxCompressedBytes} bytes`));
      return;
    }

    yauzlFromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => {
      if (err) {
        reject(new EpubValidationError(EPUB_ERROR_CODES.INVALID_ARCHIVE, `EPUB is not a valid zip: ${err.message}`));
        return;
      }
      if (!zip) {
        reject(new EpubValidationError(EPUB_ERROR_CODES.INVALID_ARCHIVE, 'EPUB zip could not be opened'));
        return;
      }

      const entries = new Map<string, Buffer>();
      const normalized = new Map<string, string>();
      let settled = false;
      let declaredTotalBytes = 0;
      let actualTotalBytes = 0;

      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        try {
          zip.close();
        } catch {
          // The archive may already be closed after a parse error.
        }
        reject(error);
      };

      const failArchive = (error: unknown): void => {
        fail(
          error instanceof EpubValidationError
            ? error
            : new EpubValidationError(
                EPUB_ERROR_CODES.INVALID_ARCHIVE,
                `EPUB zip could not be read: ${error instanceof Error ? error.message : String(error)}`,
              ),
        );
      };

      zip.on('error', failArchive);
      zip.on('end', () => {
        if (!settled) {
          settled = true;
          resolve(entries);
        }
      });
      if (zip.entryCount > limits.maxEntries) {
        fail(new EpubResourceLimitError(`EPUB contains more than ${limits.maxEntries} entries`));
        return;
      }
      zip.on('entry', (entry) => {
        if (settled) return;
        const name = decodePath(entry.fileName);
        const key = normalizeHref(name);
        const declaredBytes = entry.uncompressedSize;
        if (!Number.isFinite(declaredBytes) || declaredBytes < 0) {
          failArchive(new Error(`invalid uncompressed size for zip entry: ${name}`));
          return;
        }
        if (declaredBytes > limits.maxSingleUncompressedBytes) {
          fail(
            new EpubResourceLimitError(
              `EPUB entry exceeds ${limits.maxSingleUncompressedBytes} uncompressed bytes: ${name}`,
            ),
          );
          return;
        }
        declaredTotalBytes += declaredBytes;
        if (declaredTotalBytes > limits.maxTotalUncompressedBytes) {
          fail(new EpubResourceLimitError(`EPUB exceeds ${limits.maxTotalUncompressedBytes} total uncompressed bytes`));
          return;
        }
        zip.openReadStream(entry, (openErr, stream) => {
          if (openErr) {
            failArchive(openErr);
            return;
          }
          if (!stream) {
            failArchive(new Error(`No read stream for zip entry: ${name}`));
            return;
          }
          const chunks: Buffer[] = [];
          let actualEntryBytes = 0;
          stream.on('data', (chunk: Buffer) => {
            if (settled) return;
            actualEntryBytes += chunk.length;
            actualTotalBytes += chunk.length;
            if (actualEntryBytes > limits.maxSingleUncompressedBytes) {
              fail(
                new EpubResourceLimitError(
                  `EPUB entry exceeds ${limits.maxSingleUncompressedBytes} uncompressed bytes: ${name}`,
                ),
              );
              return;
            }
            if (actualTotalBytes > limits.maxTotalUncompressedBytes) {
              fail(
                new EpubResourceLimitError(`EPUB exceeds ${limits.maxTotalUncompressedBytes} total uncompressed bytes`),
              );
              return;
            }
            chunks.push(chunk);
          });
          stream.on('end', () => {
            if (settled) return;
            const existing = normalized.get(key);
            if (!existing || existing.length < name.length) {
              normalized.set(key, name);
            }
            entries.set(key, Buffer.concat(chunks));
            zip.readEntry();
          });
          stream.on('error', failArchive);
        });
      });

      zip.readEntry();
    });
  });
}

/** Minimal XML helpers with fast-xml-parser (attributes prefixed `@_`). */
function parseXml(xml: string): unknown {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
    isArray: (name) => name === 'item' || name === 'itemref' || name === 'navPoint' || name === 'dc:creator',
  });
  return parser.parse(xml);
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && '#text' in value && typeof value['#text'] === 'string') {
    return value['#text'];
  }
  return '';
}

/**
 * Recursively concatenate text from a fast-xml-parser value tree —
 * strings, `#text` nodes, nested objects and arrays (VersOne.Epub semantics:
 * `XElement.Value` joins all descendant text). Attribute keys (`@_*`) are
 * skipped. Handles `<dc:description><p>…</p></dc:description>` and deeper
 * nesting that `textOf` cannot see.
 *
 * Known parser boundary: fast-xml-parser object mode cannot preserve the
 * interleaving of `#text` and child elements inside mixed content (e.g.
 * `<p>First <em>sentence</em>.</p>`), so text order may be imperfect there.
 * Descendant text is still fully captured — strictly better than empty.
 */
function textOfDeep(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    let out = '';
    for (const item of value) out += textOfDeep(item);
    return out;
  }
  if (value && typeof value === 'object') {
    let out = '';
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith('@_')) continue;
      out += textOfDeep(child);
    }
    return out;
  }
  return '';
}

/** All metadata values whose local name (namespace prefix stripped) matches, case-insensitive. */
function metadataValuesByLocalName(metadata: Record<string, unknown>, name: string): unknown[] {
  const target = name.toLowerCase();
  const out: unknown[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    const local = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key;
    if (local.toLowerCase() !== target) continue;
    if (Array.isArray(value)) out.push(...value);
    else out.push(value);
  }
  return out;
}

/** First value by local name (`dc:description` / `dcterms:description` / `description` / case variants). */
function metadataByLocalName(metadata: Record<string, unknown>, name: string): unknown {
  return metadataValuesByLocalName(metadata, name)[0];
}

function findEntry(entries: Map<string, Buffer>, name: string): Buffer | undefined {
  const direct = entries.get(name);
  if (direct) return direct;
  const key = normalizeHref(name);
  return entries.get(key);
}

function findEntryCaseInsensitive(entries: Map<string, Buffer>, name: string): Buffer | undefined {
  const direct = findEntry(entries, name);
  if (direct) return direct;
  const lower = normalizeHref(name).toLowerCase();
  for (const [key] of entries) {
    if (key.toLowerCase() === lower) return entries.get(key);
  }
  return undefined;
}

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

export function normalizeLanguage(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!value) return 'en';
  const match = /^([a-z]{2,3})(?:[-_])/.exec(value);
  return match ? match[1]! : value.slice(0, 2);
}

export function mimeForHref(href: string): string {
  const ext = href.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return ext ? (IMAGE_MIME_BY_EXT[`.${ext}`] ?? 'application/octet-stream') : 'application/octet-stream';
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
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

export {
  parentDir as epubParentDir,
  findEntryCaseInsensitive as findEpubEntry,
  metadataByLocalName,
  normalizeHref as normalizeEpubHref,
  resolveAgainstBase as resolveEpubAgainstBase,
  resolveHref as resolveEpubHref,
  textOfDeep,
};
