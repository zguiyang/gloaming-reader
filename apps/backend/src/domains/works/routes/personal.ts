import { Hono } from 'hono';

import { EPUB_UPLOAD_MAX_BYTES, personalWorkUploadResultSchema } from '@gloaming/shared/works';

import { createPersonalEpubWork } from '@/domains/works/personal/personal-epub-upload';
import type { AuthVariables } from '@/infra/http/middleware/auth';
import { requireAuth } from '@/infra/http/middleware/auth';
import { sendError } from '@/infra/http/response';
import { HTTP_STATUS } from '@/shared/constants';
import { ERROR_CODES } from '@/shared/errors/codes';

export const personalWorkRoutes = new Hono<{ Variables: AuthVariables }>();

personalWorkRoutes.post('/api/works', requireAuth, async (c) => {
  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (contentLength > EPUB_UPLOAD_MAX_BYTES + 1024) {
    return sendError(c, ERROR_CODES.UPLOAD.FILE_TOO_LARGE, HTTP_STATUS.BAD_REQUEST, { maxMb: 50 });
  }

  const form = await c.req.parseBody();
  const keys = Object.keys(form);
  if (keys.some((key) => key !== 'file')) {
    return sendError(c, ERROR_CODES.VALIDATION_INVALID_INPUT, HTTP_STATUS.BAD_REQUEST);
  }
  const file = form.file;
  if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
    return sendError(c, ERROR_CODES.UPLOAD.FILE_REQUIRED, HTTP_STATUS.BAD_REQUEST);
  }

  const bytes = Buffer.from(await (file as File).arrayBuffer());
  if (bytes.length > EPUB_UPLOAD_MAX_BYTES) {
    return sendError(c, ERROR_CODES.UPLOAD.FILE_TOO_LARGE, HTTP_STATUS.BAD_REQUEST, { maxMb: 50 });
  }

  const work = await createPersonalEpubWork({
    userId: c.get('user')!.id,
    fileName: (file as File).name,
    body: bytes,
    contentType: (file as File).type,
  });
  return c.json(personalWorkUploadResultSchema.parse(work), HTTP_STATUS.CREATED);
});
