import { fromBuffer as yauzlFromBuffer } from 'yauzl';

import type { EPUB_RESOURCE_LIMITS } from '@/modules/epub-ingest/archive/limits';
import { EPUB_ERROR_CODES, EpubResourceLimitError, EpubValidationError } from '@/modules/epub-ingest/archive/limits';
import { decodePath, normalizeHref } from '@/modules/epub-ingest/opf/paths';

/** Read zip entries with both metadata and actual streamed byte limits. */
export function readZipEntries(buffer: Buffer, limits: typeof EPUB_RESOURCE_LIMITS): Promise<Map<string, Buffer>> {
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
