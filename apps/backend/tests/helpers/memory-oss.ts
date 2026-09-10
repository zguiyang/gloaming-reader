import type {
  ObjectDeleteFailure,
  ObjectDeleteManyResult,
  ObjectGetStreamResult,
  ObjectRange,
  ObjectStore,
} from '@/lib/oss';

/** In-memory ObjectStore for functional tests. */
export function createMemoryObjectStore(): ObjectStore & { store: Map<string, { body: Buffer; contentType: string }> } {
  const store = new Map<string, { body: Buffer; contentType: string }>();

  async function deleteKey(key: string): Promise<void> {
    store.delete(key);
  }

  return {
    store,
    async put(input) {
      store.set(input.key, { body: Buffer.from(input.body), contentType: input.contentType });
    },
    async get(key) {
      const value = store.get(key);
      if (!value) {
        return null;
      }
      return { body: Buffer.from(value.body), contentType: value.contentType };
    },
    async getStream(key, range?: ObjectRange): Promise<ObjectGetStreamResult | null> {
      const value = store.get(key);
      if (!value) {
        return null;
      }
      const total = value.body.length;
      const start = range?.start ?? 0;
      const end = Math.min(range?.end ?? total - 1, total - 1);
      const slice = value.body.subarray(start, end + 1);
      const partial = start !== 0 || end !== total - 1;
      return {
        stream: new Blob([slice]).stream() as ReadableStream<Uint8Array>,
        contentType: value.contentType,
        contentLength: partial ? slice.length : total,
        contentRange: partial ? `bytes ${start}-${end}/${total}` : null,
        etag: null,
      };
    },
    async exists(key) {
      return store.has(key);
    },
    async delete(key) {
      await deleteKey(key);
    },
    async deleteMany(keys): Promise<ObjectDeleteManyResult> {
      const deleted: string[] = [];
      const failed: ObjectDeleteFailure[] = [];
      for (const key of keys) {
        try {
          await deleteKey(key);
          deleted.push(key);
        } catch (error) {
          failed.push({
            key,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return { deleted, failed };
    },
    async list(prefix, cursor) {
      const keys = [...store.keys()].filter((key) => !prefix || key.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = keys.slice(start, start + 1000);
      const next = start + page.length < keys.length ? String(start + page.length) : null;
      return {
        objects: page.map((key) => ({ key, size: store.get(key)?.body.length ?? 0, lastModified: null, etag: null })),
        nextCursor: next,
        hasMore: next !== null,
      };
    },
  };
}
