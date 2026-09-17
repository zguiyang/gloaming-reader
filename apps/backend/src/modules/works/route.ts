import { Hono } from 'hono';

import { EPUB_UPLOAD_MAX_BYTES } from '@gloaming/shared/works';

import { HTTP_STATUS } from '@/constants';
import { ERROR_CODES } from '@/lib/error-codes';
import { sendError } from '@/lib/response';
import { type AuthVariables, requireAdmin } from '@/middleware/auth';
import { publishWork, retryWorkflow, unpublishWork } from '@/modules/works/admin-lifecycle';
import { getPublishedWork, listCatalogCategories, listCatalogTags, listCatalogWorks } from '@/modules/works/queries';
import {
  createAdminEpubWork,
  createAdminTextWork,
  deleteWork,
  getAdminWork,
  listAdminWorks,
  reuseAdminEpubWork,
  updateWork,
} from '@/modules/works/service';
import {
  validateAdminWorkListQuery,
  validateCatalogListQuery,
  validateCheckEpubWorkReuse,
  validateCreateAdminTextWork,
  validateRetryWorkflow,
  validateUpdateWork,
} from '@/modules/works/validator';

export const worksRoutes = new Hono<{ Variables: AuthVariables }>();

worksRoutes.post('/api/admin/works', requireAdmin, validateCreateAdminTextWork, async (c) => {
  const work = await createAdminTextWork(c.req.valid('json'));
  return c.json(work, HTTP_STATUS.CREATED);
});

/** Instant upload — dedupe lookup by content hash. Creates the work when the object exists. */
worksRoutes.post('/api/admin/works/epub/reuse', requireAdmin, validateCheckEpubWorkReuse, async (c) => {
  const result = await reuseAdminEpubWork(c.req.valid('json'));
  if (!result) {
    return c.json({ duplicated: false });
  }
  return c.json({ ...result, duplicated: true }, HTTP_STATUS.CREATED);
});

worksRoutes.post('/api/admin/works/epub', requireAdmin, async (c) => {
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

  const result = await createAdminEpubWork({
    fileName: (file as File).name,
    body: bytes,
    contentType: (file as File).type,
  });
  return c.json(result, HTTP_STATUS.CREATED);
});

worksRoutes.get('/api/admin/works', requireAdmin, validateAdminWorkListQuery, async (c) => {
  const data = await listAdminWorks(c.req.valid('query'));
  return c.json(data);
});

worksRoutes.get('/api/admin/works/:id', requireAdmin, async (c) => {
  const work = await getAdminWork(c.req.param('id'));
  return c.json(work);
});

worksRoutes.patch('/api/admin/works/:id', requireAdmin, validateUpdateWork, async (c) => {
  const work = await updateWork(c.req.param('id'), c.req.valid('json'));
  return c.json(work);
});

worksRoutes.post('/api/admin/works/:id/publish', requireAdmin, async (c) => {
  const work = await publishWork(c.req.param('id'));
  return c.json(work);
});

worksRoutes.post('/api/admin/works/:id/unpublish', requireAdmin, async (c) => {
  const work = await unpublishWork(c.req.param('id'));
  return c.json(work);
});

/** Retry / re-run the generation workflow — resume from the failed step, or re-run one step. */
worksRoutes.post('/api/admin/works/:id/workflow/retry', requireAdmin, validateRetryWorkflow, async (c) => {
  const work = await retryWorkflow(c.req.param('id'), c.req.valid('json'));
  return c.json(work);
});

worksRoutes.delete('/api/admin/works/:id', requireAdmin, async (c) => {
  await deleteWork(c.req.param('id'));
  return c.body(null, HTTP_STATUS.NO_CONTENT);
});

worksRoutes.get('/api/catalog/tags', async (c) => {
  const data = await listCatalogTags();
  return c.json(data);
});

worksRoutes.get('/api/catalog/categories', async (c) => {
  const data = await listCatalogCategories();
  return c.json(data);
});

worksRoutes.get('/api/catalog/works', validateCatalogListQuery, async (c) => {
  const data = await listCatalogWorks(c.req.valid('query'));
  return c.json(data);
});

worksRoutes.get('/api/catalog/works/:id', async (c) => {
  const work = await getPublishedWork(c.req.param('id'));
  return c.json(work);
});
