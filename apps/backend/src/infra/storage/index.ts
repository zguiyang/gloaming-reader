export { createObjectStoreFromEnv } from '@/infra/storage/create-store';
export {
  deleteManyObjects,
  deleteObject,
  getObject,
  getObjectStream,
  listObjects,
  objectExists,
  putObject,
  resetObjectStoreCache,
  setObjectStoreForTests,
} from '@/infra/storage/object-store';
export type { S3ObjectStoreConfig } from '@/infra/storage/s3';
export { createS3ObjectStore } from '@/infra/storage/s3';
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
} from '@/infra/storage/types';
