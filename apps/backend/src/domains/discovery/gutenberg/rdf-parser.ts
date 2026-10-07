import { XMLParser } from 'fast-xml-parser';

import type { SourceRecordAuthor, SourceRecordContentCandidate, SourceRecordSourceMeta } from '@gloaming/db/schema';

import { projectGutenbergCoverUrl } from './constants';
import { GutenbergSnapshotError } from './errors';
import type { ParsedSourceRecord } from './rdf-record';

type XmlNode = Record<string, unknown>;

const ARRAY_TAGS = new Set([
  'dcterms:creator',
  'pgterms:agent',
  'dcterms:language',
  'dcterms:subject',
  'pgterms:bookshelf',
  'pgterms:file',
  'dcterms:title',
  'dcterms:description',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (tagName: string) => ARRAY_TAGS.has(tagName),
});

/**
 * Parses exactly one Project Gutenberg RDF member (one ebook) and maps every
 * supported field onto the current `source_record` schema. Returns `null` when
 * the member is not a Gutenberg ebook document.
 */
export function parseGutenbergRdf(content: Buffer, memberName: string): ParsedSourceRecord | null {
  let document: unknown;
  try {
    document = parser.parse(content);
  } catch {
    throw new GutenbergSnapshotError('an RDF member could not be parsed as XML');
  }

  const root = asNode(document)?.['rdf:RDF'];
  const rdf = asNode(root);
  if (!rdf) {
    return null;
  }

  const ebook = asNode(asArray(rdf['pgterms:ebook'])[0]);
  if (!ebook) {
    return null;
  }

  const externalId = externalIdFromEbook(ebook) ?? externalIdFromMemberName(memberName);
  if (!externalId) {
    return null;
  }

  const titles = asArray(ebook['dcterms:title'])
    .map(textOf)
    .filter((value): value is string => value !== null);
  const authors = parseAuthors(ebook);
  const languages = uniqueStrings(asArray(ebook['dcterms:language']).map(recordValue));
  const subjects = uniqueStrings(asArray(ebook['dcterms:subject']).map(recordValue));
  const bookshelves = uniqueStrings(asArray(ebook['pgterms:bookshelf']).map(recordValue));
  const descriptions = asArray(ebook['dcterms:description'])
    .map(textOf)
    .filter((value): value is string => value !== null);

  const { contentCandidates, coverUrl } = parseFiles(ebook, externalId);

  const extra: Record<string, unknown> = {};
  if (titles.length > 1) {
    extra.titles = titles;
  }
  const issued = textOf(ebook['dcterms:issued']);
  if (issued) {
    extra.issued = issued;
  }
  const publisher = textOf(ebook['dcterms:publisher']);
  if (publisher) {
    extra.publisher = publisher;
  }

  const sourceMeta: SourceRecordSourceMeta = {
    ...(subjects.length > 0 ? { subjects } : {}),
    ...(bookshelves.length > 0 ? { bookshelves } : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };

  return {
    externalId,
    title: titles[0] ?? '',
    authors,
    languages,
    description: descriptions.length > 0 ? descriptions.join('\n\n') : null,
    rightsStatement: textOf(ebook['dcterms:rights']),
    coverUrl,
    contentCandidates,
    sourceMeta,
    sourceUpdatedAt: parseDate(textOf(ebook['dcterms:modified'])),
  };
}

function parseAuthors(ebook: XmlNode): SourceRecordAuthor[] {
  const authors: SourceRecordAuthor[] = [];
  for (const creator of asArray(ebook['dcterms:creator'])) {
    for (const agentValue of asArray(asNode(creator)?.['pgterms:agent'])) {
      const agent = asNode(agentValue);
      if (!agent) {
        continue;
      }
      const canonical = textOf(agent['pgterms:name']);
      const alias = textOf(agent['pgterms:alias']);
      const displayName = alias ?? canonical;
      if (!displayName) {
        continue;
      }
      const author: SourceRecordAuthor = { name: displayName, role: 'author' };
      if (canonical && canonical !== displayName) {
        author.sortName = canonical;
      }
      authors.push(author);
    }
  }
  return authors;
}

function parseFiles(
  ebook: XmlNode,
  externalId: string,
): { contentCandidates: SourceRecordContentCandidate[]; coverUrl: string } {
  const contentCandidates: SourceRecordContentCandidate[] = [];
  let coverUrl: string | null = null;

  for (const fileValue of asArray(ebook['pgterms:file'])) {
    const file = asNode(fileValue);
    if (!file) {
      continue;
    }
    const about = file['@_rdf:about'];
    const url = typeof about === 'string' ? about.trim() : '';
    if (url.length === 0) {
      continue;
    }
    const mimeType = formatMime(file['dcterms:format']);
    const isEpub = (mimeType !== null && /epub/i.test(mimeType)) || /\.epub(?:\.|$)/i.test(url);
    if (isEpub) {
      const sizeBytes = parseExtent(file['dcterms:extent']);
      const updatedAt = textOf(file['dcterms:modified']);
      contentCandidates.push({
        format: 'epub',
        url,
        ...(mimeType ? { mimeType } : {}),
        ...(sizeBytes !== null ? { sizeBytes } : {}),
        ...(updatedAt ? { updatedAt } : {}),
      });
    }
    if (coverUrl === null && mimeType !== null && /^image\//i.test(mimeType) && /cover/i.test(url)) {
      coverUrl = url;
    }
  }

  return { contentCandidates, coverUrl: coverUrl ?? projectGutenbergCoverUrl(externalId) };
}

function formatMime(value: unknown): string | null {
  const node = asNode(value);
  if (!node) {
    return null;
  }
  const description = asNode(node['rdf:Description']) ?? node;
  const valueNode = asNode(description['rdf:value']) ?? description;
  const resource = valueNode['@_rdf:resource'];
  if (typeof resource === 'string' && resource.length > 0) {
    return normalizeFormatResource(resource);
  }
  return textOf(valueNode['rdf:value']) ?? textOf(valueNode);
}

function normalizeFormatResource(resource: string): string {
  const segment = resource.split('/').pop() ?? resource;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function recordValue(value: unknown): string | null {
  const node = asNode(value);
  if (!node) {
    return textOf(value);
  }
  const description = asNode(node['rdf:Description']) ?? node;
  return textOf(description['rdf:value']) ?? textOf(description['#text']) ?? textOf(description);
}

function externalIdFromEbook(ebook: XmlNode): string | null {
  const about = ebook['@_rdf:about'];
  if (typeof about !== 'string') {
    return null;
  }
  const ebookMatch = /ebooks\/(\d+)/.exec(about);
  if (ebookMatch) {
    return ebookMatch[1]!;
  }
  const trailing = /(\d+)\s*$/.exec(about.trim());
  return trailing?.[1] ?? null;
}

function externalIdFromMemberName(memberName: string): string | null {
  const match = /pg(\d+)\.rdf$/i.exec(memberName) ?? /(\d+)\D*$/.exec(memberName);
  return match?.[1] ?? null;
}

function parseExtent(value: unknown): number | null {
  const text = textOf(value);
  if (!text) {
    return null;
  }
  const parsed = Number.parseInt(text.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function uniqueStrings(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))];
}

function asNode(value: unknown): XmlNode | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as XmlNode;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  const node = asNode(value);
  if (node && '#text' in node) {
    return textOf(node['#text']);
  }
  return null;
}
