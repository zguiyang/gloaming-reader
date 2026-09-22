export type { AcquireUploadedObjectInput, AcquireUploadedObjectResult } from '@/domains/uploads/deduplication';
export { acquireUploadedObject } from '@/domains/uploads/deduplication';
export type { UploadedFileMeta } from '@/domains/uploads/registry';
export { findUploadedObjectByHash } from '@/domains/uploads/registry';
export { releaseUploadedObject } from '@/domains/uploads/release';
export { uploadObjectFile } from '@/domains/uploads/storage';
export type { UploadSpec } from '@/domains/uploads/validation';
export {
  fileExtension,
  hashFileContent,
  isValidContentHash,
  isZipFile,
  validateUploadInput,
} from '@/domains/uploads/validation';
