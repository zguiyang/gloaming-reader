import { gunzipSync } from 'node:zlib';

import type { SourceRecordAuthor, SourceRecordContentCandidate, SourceRecordSourceMeta } from '@/shared/discovery';

import {
  PROJECT_GUTENBERG_CSV_SNAPSHOT_URL,
  PROJECT_GUTENBERG_USER_AGENT,
  projectGutenbergCoverUrl,
  projectGutenbergEpubImagesUrl,
} from './constants';
import { GutenbergSnapshotError } from './errors';

/** One CSV row mapped for staging upsert / promote. */
export type CatalogEntryDraft = {
  externalId: string;
  title: string;
  authors: SourceRecordAuthor[];
  languages: string[];
  popularityScore: number;
  hasEpub: boolean;
  issuedAt: string | null;
  coverUrl: string | null;
  contentCandidates: SourceRecordContentCandidate[];
  sourceMeta: SourceRecordSourceMeta;
};

export type GutenbergCsvSnapshot = {
  lastModified: string | null;
  entries: CatalogEntryDraft[];
};

const CSV_HEADERS = [
  'Text#',
  'Type',
  'Issued',
  'Title',
  'Language',
  'Authors',
  'Subjects',
  'LoCC',
  'Bookshelves',
] as const;

/**
 * Downloads `pg_catalog.csv.gz` with optional If-Modified-Since.
 * Returns `null` on HTTP 304.
 */
export async function openGutenbergCsvSnapshot(options: {
  url?: string;
  ifModifiedSince?: string | null;
  signal?: AbortSignal;
}): Promise<GutenbergCsvSnapshot | null> {
  const url = options.url ?? PROJECT_GUTENBERG_CSV_SNAPSHOT_URL;
  const headers: Record<string, string> = {
    Accept: 'application/gzip, application/octet-stream;q=0.9, */*;q=0.1',
    'User-Agent': PROJECT_GUTENBERG_USER_AGENT,
  };
  if (options.ifModifiedSince) {
    headers['If-Modified-Since'] = options.ifModifiedSince;
  }

  let response: Response;
  try {
    response = await fetch(url, { headers, signal: options.signal, redirect: 'follow' });
  } catch {
    throw new GutenbergSnapshotError(
      options.signal?.aborted ? 'the snapshot download was aborted' : 'the snapshot download could not be started',
    );
  }

  if (response.status === 304) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new GutenbergSnapshotError(`the snapshot download failed with HTTP status ${response.status}`);
  }

  const lastModified = response.headers.get('last-modified');
  let compressed: ArrayBuffer;
  try {
    compressed = await response.arrayBuffer();
  } catch {
    throw new GutenbergSnapshotError(
      options.signal?.aborted
        ? 'the snapshot download was aborted'
        : 'the snapshot download failed while reading the body',
    );
  }

  let csvText: string;
  try {
    csvText = gunzipSync(Buffer.from(compressed)).toString('utf8');
  } catch {
    throw new GutenbergSnapshotError('the CSV catalog could not be decompressed');
  }

  return {
    lastModified,
    entries: parseGutenbergCsvCatalog(csvText),
  };
}

/** Parses the official PG CSV body into staging drafts (Text rows only). */
export function parseGutenbergCsvCatalog(csvText: string): CatalogEntryDraft[] {
  const rows = parseCsvRecords(csvText);
  if (rows.length === 0) {
    throw new GutenbergSnapshotError('the CSV catalog is empty');
  }

  const header = rows[0]!;
  for (const expected of CSV_HEADERS) {
    if (!header.includes(expected)) {
      throw new GutenbergSnapshotError(`the CSV catalog is missing the ${expected} column`);
    }
  }

  const index = Object.fromEntries(CSV_HEADERS.map((name) => [name, header.indexOf(name)])) as Record<
    (typeof CSV_HEADERS)[number],
    number
  >;

  const drafts: CatalogEntryDraft[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i]!;
    const type = (row[index.Type] ?? '').trim();
    if (type.toLowerCase() !== 'text') continue;

    const externalId = (row[index['Text#']] ?? '').trim();
    if (!/^\d+$/.test(externalId)) continue;

    const title = (row[index.Title] ?? '').trim() || `Project Gutenberg #${externalId}`;
    const languages = splitList(row[index.Language] ?? '');
    const authors = parseAuthors(row[index.Authors] ?? '');
    const issuedRaw = (row[index.Issued] ?? '').trim();
    const issuedAt = /^\d{4}-\d{2}-\d{2}$/.test(issuedRaw) ? issuedRaw : null;
    const subjects = splitList(row[index.Subjects] ?? '');
    const bookshelves = splitList(row[index.Bookshelves] ?? '');

    drafts.push({
      externalId,
      title,
      authors,
      languages: languages.length > 0 ? languages : ['en'],
      popularityScore: issuedToPopularityScore(issuedAt),
      hasEpub: true,
      issuedAt,
      coverUrl: projectGutenbergCoverUrl(externalId),
      contentCandidates: [
        {
          format: 'epub',
          url: projectGutenbergEpubImagesUrl(externalId),
          mimeType: 'application/epub+zip',
        },
      ],
      sourceMeta: {
        subjects: subjects.length > 0 ? subjects : undefined,
        bookshelves: bookshelves.length > 0 ? bookshelves : undefined,
        extra: { rankBasis: 'issued', mediaType: type },
      },
    });
  }

  if (drafts.length === 0) {
    throw new GutenbergSnapshotError('the CSV catalog contained no Text rows');
  }
  return drafts;
}

/** Newer Issued → higher score; missing Issued → 0. */
export function issuedToPopularityScore(issuedAt: string | null): number {
  if (!issuedAt) return 0;
  const ms = Date.parse(`${issuedAt}T00:00:00Z`);
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor(ms / 86_400_000));
}

function parseAuthors(raw: string): SourceRecordAuthor[] {
  return splitList(raw).map((name) => ({ name, sortName: name }));
}

function splitList(raw: string): string[] {
  return raw
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Minimal RFC4180 CSV parser for the official PG catalog shape. */
function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') records.push(row);
      row = [];
      continue;
    }
    if (ch === '\r') continue;
    field += ch;
  }

  if (inQuotes) {
    throw new GutenbergSnapshotError('the CSV catalog has an unterminated quoted field');
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  return records;
}
