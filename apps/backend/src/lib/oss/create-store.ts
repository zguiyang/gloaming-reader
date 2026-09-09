import { type Env, isR2ObjectStorageConfigured } from '@/lib/env';
import { createR2ObjectStore } from '@/lib/oss/r2';
import type { ObjectStore } from '@/lib/oss/types';

/**
 * Build an ObjectStore from env. Boot requires all four R2_* vars; unknown drivers Fail Fast.
 * Returns null only if a caller passes an incomplete Env object (unit tests).
 */
export function createObjectStoreFromEnv(config: Env): ObjectStore | null {
  if (config.OSS_DRIVER !== 'r2') {
    throw new Error(`Unsupported object storage driver: ${config.OSS_DRIVER}`);
  }
  if (!isR2ObjectStorageConfigured(config)) {
    return null;
  }
  return createR2ObjectStore({
    accountId: config.R2_ACCOUNT_ID,
    bucket: config.R2_BUCKET,
    accessKeyId: config.R2_ACCESS_KEY_ID,
    secretAccessKey: config.R2_SECRET_ACCESS_KEY,
  });
}
