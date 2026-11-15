import { EPUB_UPLOAD_MAX_BYTES, personalWorkUploadResultSchema } from '@/shared/works';

import { createPersonalEpubWork } from '@/server/domains/works/personal/personal-epub-upload';
import { AppError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';
import { HTTP_STATUS } from '@/server/shared/constants';
import { jsonOk } from '@/server/infra/http/next-json';
import { enforceUserRateLimit } from '@/server/infra/http/next-rate-limit';
import { requireIdentity } from '@/server/infra/http/next-session';
import { withApiError } from '@/server/infra/http/next-route';

export const dynamic = 'force-dynamic';

/** Multipart boundaries, part headers and field names add a small fixed overhead. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MAX_BODY_BYTES = EPUB_UPLOAD_MAX_BYTES + MULTIPART_OVERHEAD_BYTES;

function fileTooLargeError() {
  return new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.UPLOAD.FILE_TOO_LARGE, { maxMb: 50 });
}

/**
 * Enforce the upload cap while the body is arriving. `request.formData()` would
 * buffer a chunked request of any size before the file check runs, so a client
 * that omits `Content-Length` could exhaust memory.
 */
function capBodyStream(body: ReadableStream<Uint8Array> | null, onExceeded: () => void): ReadableStream<Uint8Array> {
  if (!body) {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
  }

  let received = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > MAX_BODY_BYTES) {
          onExceeded();
          controller.error(new Error('upload_body_too_large'));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

export const POST = withApiError(async (request: Request) => {
  const identity = await requireIdentity(request);
  const limited = await enforceUserRateLimit(request, 'epubUpload', identity.user.id);
  if (limited) return limited;

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_INVALID_INPUT);
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    throw fileTooLargeError();
  }

  let bodyExceeded = false;
  let form: FormData;
  try {
    form = await new Response(
      capBodyStream(request.body, () => (bodyExceeded = true)),
      {
        headers: { 'content-type': contentType },
      },
    ).formData();
  } catch (error) {
    if (bodyExceeded) throw fileTooLargeError();
    if (error instanceof TypeError) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_INVALID_INPUT);
    }
    throw error;
  }

  const keys = [...form.keys()];
  if (keys.some((key) => key !== 'file')) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_INVALID_INPUT);
  }

  const file = form.get('file');
  if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.UPLOAD.FILE_REQUIRED);
  }

  const uploadFile = file as File;
  const bytes = Buffer.from(await uploadFile.arrayBuffer());
  if (bytes.length > EPUB_UPLOAD_MAX_BYTES) {
    throw fileTooLargeError();
  }

  const work = await createPersonalEpubWork({
    userId: identity.user.id,
    fileName: uploadFile.name,
    body: bytes,
    contentType: uploadFile.type,
  });
  return jsonOk(personalWorkUploadResultSchema.parse(work), { status: HTTP_STATUS.CREATED });
});
