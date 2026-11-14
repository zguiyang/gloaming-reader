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

export const POST = withApiError(async (request: Request) => {
  const identity = await requireIdentity(request);
  const limited = await enforceUserRateLimit(request, 'epubUpload', identity.user.id);
  if (limited) return limited;

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > EPUB_UPLOAD_MAX_BYTES + 1024) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.UPLOAD.FILE_TOO_LARGE, { maxMb: 50 });
  }

  const form = await request.formData();
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
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.UPLOAD.FILE_TOO_LARGE, { maxMb: 50 });
  }

  const work = await createPersonalEpubWork({
    userId: identity.user.id,
    fileName: uploadFile.name,
    body: bytes,
    contentType: uploadFile.type,
  });
  return jsonOk(personalWorkUploadResultSchema.parse(work), { status: HTTP_STATUS.CREATED });
});
