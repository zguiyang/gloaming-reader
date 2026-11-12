export { createObjectStoreFromEnv } from '@/server/infra/storage/create-store';
export { RangeNotSatisfiableError } from '@/server/infra/storage/errors';
export {
  deleteManyObjects,
  deleteObject,
  getObject,
  getObjectSize,
  getObjectStream,
  listObjects,
  objectExists,
  putObject,
  resetObjectStoreCache,
  setObjectStoreForTests,
} from '@/server/infra/storage/object-store';
export type { S3ObjectStoreConfig } from '@/server/infra/storage/s3';
export { createS3ObjectStore } from '@/server/infra/storage/s3';
export type {
  ObjectDeleteFailure,
  ObjectDeleteManyResult,
  ObjectGetResult,
  ObjectGetStreamResult,
  ObjectHeadResult,
  ObjectListItem,
  ObjectListResult,
  ObjectPutInput,
  ObjectRange,
  ObjectStore,
} from '@/server/infra/storage/types';
