export type { AcquireUploadedObjectInput, AcquireUploadedObjectResult } from '@/domains/assets/uploads/deduplication';
export { acquireUploadedObject } from '@/domains/assets/uploads/deduplication';
export type { UploadedFileMeta } from '@/domains/assets/uploads/registry';
export { findUploadedObjectByHash } from '@/domains/assets/uploads/registry';
export { releaseUploadedObject } from '@/domains/assets/uploads/release';
export { uploadObjectFile } from '@/domains/assets/uploads/storage';
export type { UploadSpec } from '@/domains/assets/uploads/validation';
export {
  fileExtension,
  hashFileContent,
  isValidContentHash,
  isZipFile,
  validateUploadInput,
} from '@/domains/assets/uploads/validation';
