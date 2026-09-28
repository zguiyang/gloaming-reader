import { Hono } from 'hono';

import { EPUB_UPLOAD_MAX_BYTES } from '@gloaming/shared/works';

import { deleteWork } from '@/application/commands/delete-work';
import { retryWorkflow } from '@/application/commands/retry-workflow';
import {
  createAdminTextWork,
  createCatalogEpubWork,
  getAdminWork,
  listAdminWorks,
  publishWork,
  reuseCatalogEpubWork,
  unpublishWork,
  updateWork,
} from '@/domains/works/admin';
import {
  validateAdminWorkListQuery,
  validateCheckEpubWorkReuse,
  validateCreateAdminTextWork,
  validateRetryWorkflow,
  validateUpdateWork,
} from '@/domains/works/routes/validator';
import type { AuthVariables } from '@/infra/http/middleware/auth';
import { requireAdmin } from '@/infra/http/middleware/auth';
import { sendError } from '@/infra/http/response';
import { HTTP_STATUS } from '@/shared/constants';
import { ERROR_CODES } from '@/shared/errors/codes';

export const catalogAdminRoutes = new Hono<{ Variables: AuthVariables }>();

catalogAdminRoutes.post('/api/admin/catalog/works', requireAdmin, validateCreateAdminTextWork, async (c) => {
  const work = await createAdminTextWork(c.req.valid('json'));
  return c.json(work, HTTP_STATUS.CREATED);
});

/** Instant upload — dedupe lookup by content hash. Creates the work when the object exists. */
catalogAdminRoutes.post('/api/admin/catalog/works/epub/reuse', requireAdmin, validateCheckEpubWorkReuse, async (c) => {
  const result = await reuseCatalogEpubWork(c.req.valid('json'));
  if (!result) {
    return c.json({ duplicated: false });
  }
  return c.json({ ...result, duplicated: true }, HTTP_STATUS.CREATED);
});

catalogAdminRoutes.post('/api/admin/catalog/works/epub', requireAdmin, async (c) => {
  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (contentLength > EPUB_UPLOAD_MAX_BYTES + 1024) {
    return sendError(c, ERROR_CODES.UPLOAD.FILE_TOO_LARGE, HTTP_STATUS.BAD_REQUEST, { maxMb: 50 });
  }

  const form = await c.req.parseBody();
  const file = form['file'];
  if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
    return sendError(c, ERROR_CODES.UPLOAD.FILE_REQUIRED, HTTP_STATUS.BAD_REQUEST);
  }

  const bytes = Buffer.from(await (file as File).arrayBuffer());
  if (bytes.length > EPUB_UPLOAD_MAX_BYTES) {
    return sendError(c, ERROR_CODES.UPLOAD.FILE_TOO_LARGE, HTTP_STATUS.BAD_REQUEST, { maxMb: 50 });
  }

  const result = await createCatalogEpubWork({
    fileName: (file as File).name,
    body: bytes,
    contentType: (file as File).type,
  });
  return c.json(result, HTTP_STATUS.CREATED);
});

catalogAdminRoutes.get('/api/admin/catalog/works', requireAdmin, validateAdminWorkListQuery, async (c) => {
  const data = await listAdminWorks(c.req.valid('query'));
  return c.json(data);
});

catalogAdminRoutes.get('/api/admin/catalog/works/:id', requireAdmin, async (c) => {
  const work = await getAdminWork(c.req.param('id'));
  return c.json(work);
});

catalogAdminRoutes.patch('/api/admin/catalog/works/:id', requireAdmin, validateUpdateWork, async (c) => {
  const work = await updateWork(c.req.param('id'), c.req.valid('json'));
  return c.json(work);
});

catalogAdminRoutes.post('/api/admin/catalog/works/:id/publish', requireAdmin, async (c) => {
  const work = await publishWork(c.req.param('id'));
  return c.json(work);
});

catalogAdminRoutes.post('/api/admin/catalog/works/:id/unpublish', requireAdmin, async (c) => {
  const work = await unpublishWork(c.req.param('id'));
  return c.json(work);
});

/** Retry / re-run the generation workflow — resume from the failed step, or re-run one step. */
catalogAdminRoutes.post(
  '/api/admin/catalog/works/:id/workflow/retry',
  requireAdmin,
  validateRetryWorkflow,
  async (c) => {
    const work = await retryWorkflow(c.req.param('id'), c.req.valid('json'));
    return c.json(work);
  },
);

catalogAdminRoutes.delete('/api/admin/catalog/works/:id', requireAdmin, async (c) => {
  await deleteWork(c.req.param('id'));
  return c.body(null, HTTP_STATUS.NO_CONTENT);
});
