export { createObjectStoreFromEnv } from '@/lib/oss/create-store';
export { createS3ObjectStore, type S3ObjectStoreConfig } from '@/lib/oss/s3';
export type {
  ObjectDeleteFailure,
  ObjectDeleteManyResult,
  ObjectGetResult,
  ObjectGetStreamResult,
  ObjectListItem,
  ObjectListResult,
  ObjectPutInput,
  ObjectRange,
  ObjectStore,
} from '@/lib/oss/types';
