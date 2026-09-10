import { HTTP_STATUS } from '@/constants';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { rootLogger } from '@/lib/logger';
import {
  createObjectStoreFromEnv,
  type ObjectDeleteFailure,
  type ObjectDeleteManyResult,
  type ObjectGetResult,
  type ObjectGetStreamResult,
  type ObjectListResult,
  type ObjectPutInput,
  type ObjectRange,
  type ObjectStore,
} from '@/lib/oss';

/** S3 DeleteObjects accepts at most 1000 keys; keep the facade aligned. */
const DELETE_MANY_CHUNK_SIZE = 1000;
const DELETE_MANY_FALLBACK_CONCURRENCY = 8;

const ossLogger = rootLogger.child({ module: 'Oss' });

let cachedStore: ObjectStore | null | undefined;

function resolveStore(): ObjectStore {
  if (cachedStore !== undefined) {
    if (!cachedStore) {
      throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, 'Object storage is not configured');
    }
    return cachedStore;
  }

  try {
    cachedStore = createObjectStoreFromEnv(env);
  } catch (error) {
    ossLogger.error({ err: error }, 'Failed to create object store');
    throw new AppError(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      error instanceof Error ? error.message : 'Object storage is unavailable',
    );
  }

  if (!cachedStore) {
    throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, 'Object storage is not configured');
  }
  return cachedStore;
}

/** Test seam — clears the cached ObjectStore instance. */
export function resetObjectStoreCache(): void {
  cachedStore = undefined;
}

/** Test seam — inject a store (e.g. in-memory) without S3 credentials. */
export function setObjectStoreForTests(store: ObjectStore | null): void {
  cachedStore = store;
}

export async function putObject(input: ObjectPutInput): Promise<void> {
  await resolveStore().put(input);
}

export async function getObject(key: string): Promise<ObjectGetResult | null> {
  return resolveStore().get(key);
}

export async function getObjectStream(key: string, range?: ObjectRange): Promise<ObjectGetStreamResult | null> {
  return resolveStore().getStream(key, range);
}

export async function objectExists(key: string): Promise<boolean> {
  return resolveStore().exists(key);
}

export async function deleteObject(key: string): Promise<void> {
  await resolveStore().delete(key);
}

export async function deleteManyObjects(keys: string[]): Promise<ObjectDeleteManyResult> {
  if (keys.length === 0) {
    return { deleted: [], failed: [] };
  }

  const store = resolveStore();
  const deleteMany = store.deleteMany?.bind(store);
  if (deleteMany) {
    const deleted: string[] = [];
    const failed: ObjectDeleteFailure[] = [];
    for (const chunk of chunkKeys(keys, DELETE_MANY_CHUNK_SIZE)) {
      const result = await deleteMany(chunk);
      deleted.push(...result.deleted);
      failed.push(...result.failed);
    }
    return { deleted, failed };
  }

  return deleteManyWithBoundedConcurrency(store, keys);
}

export async function listObjects(prefix?: string, cursor?: string): Promise<ObjectListResult> {
  return resolveStore().list(prefix, cursor);
}

function chunkKeys(keys: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < keys.length; index += size) {
    chunks.push(keys.slice(index, index + size));
  }
  return chunks;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Run at most `concurrency` tasks at once — never `Promise.all` over the full key list. */
async function mapWithBoundedConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      await worker(items[index]!);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
}

async function deleteManyWithBoundedConcurrency(store: ObjectStore, keys: string[]): Promise<ObjectDeleteManyResult> {
  const deleted: string[] = [];
  const failed: ObjectDeleteFailure[] = [];

  await mapWithBoundedConcurrency(keys, DELETE_MANY_FALLBACK_CONCURRENCY, async (key) => {
    try {
      await store.delete(key);
      deleted.push(key);
    } catch (error) {
      failed.push({ key, error: errorMessage(error) });
    }
  });

  return { deleted, failed };
}
