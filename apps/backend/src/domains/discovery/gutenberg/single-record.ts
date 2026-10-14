import {
  computePublicClassificationFingerprint,
  recordPublicClassificationEvidenceBatch,
} from '@/domains/discovery/categories';
import {
  ensureDiscoverySource,
  loadClassificationEvidenceByExternalId,
  upsertSourceRecords,
} from '@/domains/discovery/sync/repository';
import { parseEpub } from '@/domains/ingest/epub/opf/parse';
import { rootLogger } from '@/infra/logging/logger';

import {
  PROJECT_GUTENBERG_SOURCE_KEY,
  PROJECT_GUTENBERG_SOURCE_TYPE,
  PROJECT_GUTENBERG_USER_AGENT,
} from './constants';
import { GutenbergSnapshotError } from './errors';
import { parseGutenbergRdf } from './rdf-parser';

const logger = rootLogger.child({ module: 'DiscoveryGutenbergSingleImport' });

/** Upper bound for one per-ebook RDF document held in memory. */
export const GUTENBERG_SINGLE_RDF_MAX_BYTES = 8 * 1024 * 1024;
/** Timeout for the single RDF fetch. */
export const GUTENBERG_SINGLE_RDF_TIMEOUT_MS = 15_000;

/** Strict `pg<digits>.epub` sample file-name contract; returns the external id. */
const SAMPLE_FILE_NAME_PATTERN = /^pg(\d+)\.epub$/i;
export function gutenbergSampleExternalId(fileName: string): string | null {
  return SAMPLE_FILE_NAME_PATTERN.exec(fileName.trim())?.[1] ?? null;
}

/** Exact per-ebook RDF URL; never any other upstream path. */
export function gutenbergSingleRdfUrl(externalId: string): string {
  return `https://www.gutenberg.org/cache/epub/${externalId}/pg${externalId}.rdf`;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export type GutenbergSingleImportResult = {
  externalId: string;
  title: string;
  sourceRecordId: string;
  created: boolean;
};

/**
 * Bounded single-record Project Gutenberg import from an uploaded sample EPUB.
 * The uploaded bytes are parsed in memory only (never persisted) and must match
 * the single RDF record fetched for the id encoded in the file name. Metadata-
 * only on the discovery side: no ReadingWork is created.
 */
export async function importProjectGutenbergSingleSample(input: {
  fileName: string;
  bytes: Buffer;
}): Promise<GutenbergSingleImportResult> {
  const externalId = gutenbergSampleExternalId(input.fileName);
  if (!externalId) {
    throw new GutenbergSnapshotError('the sample file name must be pg<digits>.epub');
  }

  // Memory-only EPUB verification; bytes are never persisted.
  const book = await parseEpub(input.bytes);

  const content = await fetchSingleRdf(externalId);
  const record = parseGutenbergRdf(content, `pg${externalId}.rdf`);
  if (!record) {
    throw new GutenbergSnapshotError('the fetched RDF did not contain one ebook record');
  }
  if (record.externalId !== externalId) {
    throw new GutenbergSnapshotError('the fetched RDF belongs to a different ebook');
  }

  // Require the uploaded EPUB to agree with the RDF metadata.
  if (!book.title || normalize(book.title) !== normalize(record.title)) {
    throw new GutenbergSnapshotError('the uploaded EPUB title does not match the Gutenberg record');
  }
  const recordNames = new Set(record.authors.map((author) => normalize(author.name)));
  if (!book.authors.some((name) => recordNames.has(normalize(name)))) {
    throw new GutenbergSnapshotError('the uploaded EPUB has no author matching the Gutenberg record');
  }

  const source = await ensureDiscoverySource(PROJECT_GUTENBERG_SOURCE_KEY, PROJECT_GUTENBERG_SOURCE_TYPE);
  const observedAt = new Date();
  const previousEvidence = (await loadClassificationEvidenceByExternalId(source.id, [externalId])).get(externalId);
  const [upserted] = await upsertSourceRecords(source.id, [record], observedAt);
  if (!upserted) {
    throw new GutenbergSnapshotError('the SourceRecord upsert did not return a row');
  }

  await recordPublicClassificationEvidenceBatch(
    [
      {
        sourceRecordId: upserted.id,
        fingerprint: computePublicClassificationFingerprint(toEvidence(record)),
        previousFingerprint: previousEvidence
          ? computePublicClassificationFingerprint(toEvidence(previousEvidence))
          : null,
        isNew: !previousEvidence,
      },
    ],
    new Date(),
  );

  logger.info(
    { sourceKey: PROJECT_GUTENBERG_SOURCE_KEY, externalId, created: !previousEvidence },
    'Gutenberg single-sample import succeeded',
  );

  return { externalId, title: record.title, sourceRecordId: upserted.id, created: !previousEvidence };
}

function toEvidence(input: {
  title: string;
  authors: Array<{ name: string }>;
  languages: string[];
  description: string | null;
  sourceMeta: { subjects?: string[]; bookshelves?: string[] };
}) {
  return {
    title: input.title,
    authors: input.authors.map((author) => author.name),
    languages: input.languages,
    description: input.description,
    subjects: input.sourceMeta.subjects ?? [],
    bookshelves: input.sourceMeta.bookshelves ?? [],
  };
}

async function fetchSingleRdf(externalId: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GUTENBERG_SINGLE_RDF_TIMEOUT_MS);
  try {
    const response = await fetch(gutenbergSingleRdfUrl(externalId), {
      headers: {
        Accept: 'application/rdf+xml, application/xml;q=0.9, */*;q=0.1',
        'User-Agent': PROJECT_GUTENBERG_USER_AGENT,
      },
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      throw new GutenbergSnapshotError(`the RDF download failed with HTTP status ${response.status}`);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk as Uint8Array);
      total += buffer.length;
      if (total > GUTENBERG_SINGLE_RDF_MAX_BYTES) {
        controller.abort();
        throw new GutenbergSnapshotError('the RDF download exceeded the size limit');
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    if (error instanceof GutenbergSnapshotError) throw error;
    throw new GutenbergSnapshotError(
      controller.signal.aborted ? 'the RDF download timed out' : 'the RDF download could not be completed',
    );
  } finally {
    clearTimeout(timer);
  }
}
