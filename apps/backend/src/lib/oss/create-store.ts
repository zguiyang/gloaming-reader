import { type CommonEnv, isS3ObjectStorageConfigured } from '@/lib/env-common';
import { createS3ObjectStore } from '@/lib/oss/s3';
import type { ObjectStore } from '@/lib/oss/types';

/**
 * Build an ObjectStore from env. Boot requires all S3_* vars.
 * Returns null only if a caller passes an incomplete Env object (unit tests).
 */
export function createObjectStoreFromEnv(config: CommonEnv): ObjectStore | null {
  if (!isS3ObjectStorageConfigured(config)) {
    return null;
  }
  return createS3ObjectStore({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    bucket: config.S3_BUCKET,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
  });
}
