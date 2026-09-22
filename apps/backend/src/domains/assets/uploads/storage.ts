import type { UploadedFileMeta } from '@/domains/assets/uploads/registry';
import { hashFileContent, type UploadSpec, validateUploadInput } from '@/domains/assets/uploads/validation';
import { putObject } from '@/infra/storage';

/**
 * Low-level put without dedup bookkeeping. Use `acquireUploadedObject` for
 * content-addressed uploads; this remains for callers that manage keys themselves.
 */
export async function uploadObjectFile(input: {
  key: string;
  fileName: string;
  body: Buffer;
  contentType: string;
  spec: UploadSpec;
}): Promise<UploadedFileMeta> {
  const { key, fileName, body, contentType, spec } = input;
  const { mimeType } = validateUploadInput({ fileName, body, contentType, spec });
  await putObject({ key, body, contentType: mimeType });
  return { storageKey: key, mimeType, contentHash: hashFileContent(body), size: body.length };
}

export async function storeValidatedUpload(input: {
  storageKey: string;
  body: Buffer;
  mimeType: string;
}): Promise<void> {
  await putObject({ key: input.storageKey, body: input.body, contentType: input.mimeType });
}
