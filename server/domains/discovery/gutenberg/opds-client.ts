import { XMLParser } from 'fast-xml-parser';

import type { SourceRecordAuthor, SourceRecordContentCandidate } from '@/shared/discovery';

import {
  PROJECT_GUTENBERG_OPDS_ORIGIN,
  PROJECT_GUTENBERG_OPDS_PAGE_SIZE,
  PROJECT_GUTENBERG_OPDS_TIMEOUT_MS,
  PROJECT_GUTENBERG_USER_AGENT,
} from './constants';

export class GutenbergOpdsError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'GutenbergOpdsError';
    this.status = status;
  }
}

export type OpdsFeedEntry = {
  readonly externalId: string;
  readonly title: string;
  readonly authors: SourceRecordAuthor[];
  readonly languages: string[];
  readonly description: string | null;
  readonly coverUrl: string | null;
  readonly contentCandidates: SourceRecordContentCandidate[];
  readonly subjects: string[];
  readonly bookshelves: string[];
  readonly rightsStatement: string | null;
  readonly sourceUpdatedAt: string | null;
};

export type OpdsFeedPage = {
  readonly entries: OpdsFeedEntry[];
  readonly hasMore: boolean;
  readonly startIndex: number;
  readonly itemsPerPage: number;
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
  isArray: (name) =>
    name === 'entry' || name === 'link' || name === 'author' || name === 'category' || name === 'language',
});

type XmlNode = Record<string, unknown>;

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object' && value !== null && '#text' in value) {
    return textOf((value as XmlNode)['#text']);
  }
  return '';
}

function absoluteUrl(href: string): string {
  try {
    const url = new URL(href, PROJECT_GUTENBERG_OPDS_ORIGIN);
    if (url.hostname === 'www.gutenberg.org' || url.hostname === 'gutenberg.org') {
      url.protocol = 'https:';
      url.hostname = 'www.gutenberg.org';
    }
    return url.toString();
  } catch {
    return href;
  }
}

function extractExternalId(entry: XmlNode): string | null {
  const idText = textOf(entry.id);
  const fromUrl = idText.match(/\/ebooks\/(\d+)(?:\.opds)?/i)?.[1];
  if (fromUrl) return fromUrl;
  const fromUrn = idText.match(/^urn:gutenberg:(\d+)(?::|$)/i)?.[1];
  if (fromUrn) return fromUrn;

  for (const link of asArray(entry.link as XmlNode | XmlNode[] | undefined)) {
    const href = textOf(link['@_href']);
    const match = href.match(/\/ebooks\/(\d+)(?:\.opds)?(?:\?|$)/i);
    if (match?.[1]) return match[1];
  }

  // Book feeds nest the numeric id in xhtml content ("EBook No.: 1342").
  const content = entry.content;
  if (content && typeof content === 'object') {
    const body = textOf(content);
    const fromContent = body.match(/EBook No\.:\s*(\d+)/i)?.[1];
    if (fromContent) return fromContent;
  }
  return null;
}

function parseAuthors(entry: XmlNode): SourceRecordAuthor[] {
  const authors = asArray(entry.author as XmlNode | XmlNode[] | undefined)
    .map((author) => {
      const name = textOf(author.name).trim();
      return name ? { name } : null;
    })
    .filter((author): author is SourceRecordAuthor => author != null);
  if (authors.length > 0) return authors;

  // List feeds often put the author in <content type="text">Author Name</content>.
  const content = entry.content;
  if (typeof content === 'string' && content.trim()) {
    return [{ name: content.trim() }];
  }
  if (content && typeof content === 'object') {
    const body = textOf(content).trim();
    if (body && !body.includes('<')) {
      return [{ name: body }];
    }
  }
  return [];
}

function parseLanguages(entry: XmlNode): string[] {
  const languages = asArray(entry.language as unknown)
    .map((value) => textOf(value).trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(languages)];
}

function parseSubjectsAndBookshelves(entry: XmlNode): { subjects: string[]; bookshelves: string[] } {
  const subjects: string[] = [];
  const bookshelves: string[] = [];
  for (const category of asArray(entry.category as XmlNode | XmlNode[] | undefined)) {
    const term = textOf(category['@_term']).trim();
    const label = textOf(category['@_label']).trim();
    const scheme = textOf(category['@_scheme']).toLowerCase();
    if (scheme.includes('lcsh') && term) {
      subjects.push(term);
      continue;
    }
    if (term.startsWith('Category: ')) {
      bookshelves.push(term);
      continue;
    }
    if (label.startsWith('Category: ')) {
      bookshelves.push(label);
    }
  }

  for (const link of asArray(entry.link as XmlNode | XmlNode[] | undefined)) {
    const title = textOf(link['@_title']).trim();
    const href = textOf(link['@_href']);
    if (href.includes('/ebooks/bookshelf/') && title.startsWith('In ')) {
      const name = title
        .replace(/^In\s+/, '')
        .replace(/…$/, '')
        .trim();
      if (name) bookshelves.push(name.startsWith('Category: ') ? name : `Category: ${name}`);
    }
  }

  return { subjects: [...new Set(subjects)], bookshelves: [...new Set(bookshelves)] };
}

function parseCoverUrl(entry: XmlNode): string | null {
  for (const link of asArray(entry.link as XmlNode | XmlNode[] | undefined)) {
    const rel = textOf(link['@_rel']);
    const href = textOf(link['@_href']);
    const type = textOf(link['@_type']).toLowerCase();
    if (!href || href.startsWith('data:')) continue;
    if (
      rel === 'http://opds-spec.org/image' ||
      (rel.includes('image') && type.startsWith('image/') && !rel.includes('thumbnail'))
    ) {
      return absoluteUrl(href);
    }
  }
  for (const link of asArray(entry.link as XmlNode | XmlNode[] | undefined)) {
    const rel = textOf(link['@_rel']);
    const href = textOf(link['@_href']);
    if (href && !href.startsWith('data:') && rel.includes('thumbnail')) {
      return absoluteUrl(href);
    }
  }
  return null;
}

function parseContentCandidates(entry: XmlNode): SourceRecordContentCandidate[] {
  const candidates: SourceRecordContentCandidate[] = [];
  for (const link of asArray(entry.link as XmlNode | XmlNode[] | undefined)) {
    const rel = textOf(link['@_rel']);
    const href = textOf(link['@_href']);
    const type = textOf(link['@_type']).toLowerCase();
    if (!href || !rel.includes('acquisition')) continue;
    if (!type.includes('epub')) continue;
    const lengthRaw = textOf(link['@_length']);
    const sizeBytes = lengthRaw ? Number.parseInt(lengthRaw, 10) : undefined;
    candidates.push({
      format: 'epub',
      url: absoluteUrl(href),
      mimeType: type || 'application/epub+zip',
      ...(Number.isFinite(sizeBytes) ? { sizeBytes } : {}),
    });
  }
  return candidates;
}

function parseDescription(entry: XmlNode): string | null {
  const summary = textOf(entry.summary).trim();
  if (summary) return summary;
  const content = entry.content;
  if (content && typeof content === 'object') {
    const type = textOf((content as XmlNode)['@_type']).toLowerCase();
    const body = textOf(content).trim();
    if (type.includes('html') && body) {
      return (
        body
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim() || null
      );
    }
  }
  return null;
}

function parseEntry(entry: XmlNode): OpdsFeedEntry | null {
  const externalId = extractExternalId(entry);
  if (!externalId) return null;
  const title = textOf(entry.title).trim() || `Ebook ${externalId}`;
  const { subjects, bookshelves } = parseSubjectsAndBookshelves(entry);
  const languages = parseLanguages(entry);
  return {
    externalId,
    title,
    authors: parseAuthors(entry),
    languages: languages.length > 0 ? languages : ['en'],
    description: parseDescription(entry),
    coverUrl: parseCoverUrl(entry),
    contentCandidates: parseContentCandidates(entry),
    subjects,
    bookshelves,
    rightsStatement: textOf(entry.rights).trim() || null,
    sourceUpdatedAt: textOf(entry.updated).trim() || null,
  };
}

function parseFeedXml(xml: string): OpdsFeedPage {
  const parsed = xmlParser.parse(xml) as XmlNode;
  const feed = (parsed.feed as XmlNode | undefined) ?? parsed;
  const entries = asArray(feed.entry as XmlNode | XmlNode[] | undefined)
    .map(parseEntry)
    .filter((entry): entry is OpdsFeedEntry => entry != null);

  const itemsPerPage = Number.parseInt(textOf(feed.itemsPerPage), 10) || PROJECT_GUTENBERG_OPDS_PAGE_SIZE;
  const startIndex = Number.parseInt(textOf(feed.startIndex), 10) || 1;
  const hasNext = asArray(feed.link as XmlNode | XmlNode[] | undefined).some(
    (link) => textOf(link['@_rel']) === 'next',
  );

  return {
    entries,
    hasMore: hasNext || entries.length >= itemsPerPage,
    startIndex,
    itemsPerPage,
  };
}

export async function fetchGutenbergOpdsFeed(pathOrUrl: string): Promise<OpdsFeedPage> {
  const url = absoluteUrl(pathOrUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROJECT_GUTENBERG_OPDS_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/atom+xml;profile=opds-catalog, application/atom+xml, application/xml, text/xml',
        'User-Agent': PROJECT_GUTENBERG_USER_AGENT,
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new GutenbergOpdsError(`OPDS request failed with HTTP ${response.status}`, response.status);
    }
    const xml = await response.text();
    if (!xml.includes('<feed') && !xml.includes('<entry')) {
      throw new GutenbergOpdsError('OPDS response was not an Atom feed', response.status);
    }
    return parseFeedXml(xml);
  } catch (error) {
    if (error instanceof GutenbergOpdsError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GutenbergOpdsError('OPDS request timed out');
    }
    throw new GutenbergOpdsError(error instanceof Error ? error.message : 'OPDS request failed');
  } finally {
    clearTimeout(timer);
  }
}
