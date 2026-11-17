import { Readable } from 'node:stream';

import type { Bzip2DecompressStream } from './bzip2';
import { createBzip2DecompressStream } from './bzip2';
import { GUTENBERG_TAR_TRAILING_MAX_BYTES, PROJECT_GUTENBERG_USER_AGENT } from './constants';
import { GutenbergSnapshotError } from './errors';
import { parseGutenbergRdf } from './rdf-parser';
import type { ParsedSourceRecord } from './rdf-record';
import { iterateTarMembers } from './tar-reader';

export type GutenbergSnapshot = {
  /** Upstream HTTP Last-Modified captured for conditional refresh. */
  lastModified: string | null;
  records: AsyncGenerator<ParsedSourceRecord>;
  close: () => void;
};

/**
 * Observability hook invoked once per legally skipped non-ebook RDF member
 * (e.g. generator/metadata files). Suspected ebook members that fail parsing
 * are NOT reported through this hook: they throw `GutenbergSnapshotError`
 * and fail the run.
 */
export type NonEbookMemberSkippedHandler = (memberName: string) => void;

/**
 * Bounded streaming pipeline over an already-open bzip2 download stream:
 * bzip2 child process -> incremental tar members -> per-record RDF parse.
 */
export function parseGutenbergSnapshotCompressedStream(
  compressed: Readable,
  signal?: AbortSignal,
  onNonEbookMemberSkipped?: NonEbookMemberSkippedHandler,
): AsyncGenerator<ParsedSourceRecord> {
  return parseRecords(createBzip2DecompressStream(compressed, signal), onNonEbookMemberSkipped);
}

/**
 * Opens the official feed with `If-Modified-Since` when a prior snapshot is
 * known. Returns `null` for HTTP 304 so callers can skip parsing entirely.
 */
export async function openGutenbergSnapshot(options: {
  url: string;
  ifModifiedSince?: string | null;
  signal?: AbortSignal;
  onNonEbookMemberSkipped?: NonEbookMemberSkippedHandler;
}): Promise<GutenbergSnapshot | null> {
  const headers: Record<string, string> = {
    Accept: 'application/x-bzip2, application/octet-stream;q=0.9, */*;q=0.1',
    'User-Agent': PROJECT_GUTENBERG_USER_AGENT,
  };
  if (options.ifModifiedSince) {
    headers['If-Modified-Since'] = options.ifModifiedSince;
  }

  let response: Response;
  try {
    response = await fetch(options.url, { headers, signal: options.signal, redirect: 'follow' });
  } catch {
    throw new GutenbergSnapshotError(
      options.signal?.aborted ? 'the snapshot download was aborted' : 'the snapshot download could not be started',
    );
  }

  if (response.status === 304) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new GutenbergSnapshotError(`the snapshot download failed with HTTP status ${response.status}`);
  }

  const lastModified = response.headers.get('last-modified');
  const download = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  const bzip2 = createBzip2DecompressStream(download, options.signal);

  return {
    lastModified,
    records: parseRecords(bzip2, options.onNonEbookMemberSkipped),
    close: () => bzip2.close(),
  };
}

async function* parseRecords(
  bzip2: Bzip2DecompressStream,
  onNonEbookMemberSkipped?: NonEbookMemberSkippedHandler,
): AsyncGenerator<ParsedSourceRecord> {
  try {
    let sawRecord = false;
    try {
      for await (const member of iterateTarMembers(bzip2.output)) {
        if (!member.name.toLowerCase().endsWith('.rdf')) {
          continue;
        }
        // A null parse result is a legitimate non-ebook RDF member (the parser
        // throws for suspected ebook members it cannot identify), so it is
        // skipped and counted for observability rather than failing the run.
        const record = parseGutenbergRdf(member.content, member.name);
        if (!record) {
          onNonEbookMemberSkipped?.(member.name);
          continue;
        }
        sawRecord = true;
        yield record;
      }
    } catch (error) {
      // A downstream tar/parse failure stops draining stdout, which can leave bzip2
      // blocked on pipe backpressure. Tear the process down BEFORE awaiting completion
      // so the failure path cannot deadlock.
      bzip2.close();
      const completion = await bzip2.completion;
      if (error instanceof GutenbergSnapshotError) {
        throw error;
      }
      if (!completion.ok) {
        throw new GutenbergSnapshotError(completion.reason ?? 'bzip2 decompression failed');
      }
      throw error;
    }

    // The tar reader stops at the archive terminator, which can precede the end of the
    // compressed stream. Drain the bounded remainder so bzip2 cannot block on pipe
    // backpressure while we await its exit; an oversized trailing region is treated as a
    // malformed archive rather than drained indefinitely.
    await drainAfterTerminator(bzip2.output);

    const completion = await bzip2.completion;
    if (!completion.ok) {
      throw new GutenbergSnapshotError(completion.reason ?? 'bzip2 decompression failed');
    }
    if (!sawRecord) {
      throw new GutenbergSnapshotError('the snapshot archive contained no RDF records');
    }
  } finally {
    bzip2.close();
  }
}

async function drainAfterTerminator(output: Readable): Promise<void> {
  let remaining = GUTENBERG_TAR_TRAILING_MAX_BYTES;
  for await (const chunk of output) {
    remaining -= chunk.length;
    if (remaining < 0) {
      throw new GutenbergSnapshotError('the tar archive had an unexpected trailing region');
    }
  }
}
