import { Hono } from 'hono';

import { EPUB_UPLOAD_MAX_BYTES } from '@gloaming/shared/works';

import { HTTP_STATUS } from '@/constants';
import { type AuthVariables, requireAdmin } from '@/middleware/auth';
import * as worksService from '@/modules/works/service';
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
  const work = await worksService.createAdminTextWork(c.req.valid('json'));
  return c.json(work, HTTP_STATUS.CREATED);
});

/** Instant upload — dedupe lookup by content hash. Creates the work when the object exists. */
worksRoutes.post('/api/admin/works/epub/reuse', requireAdmin, validateCheckEpubWorkReuse, async (c) => {
  const result = await worksService.reuseAdminEpubWork(c.req.valid('json'));
  if (!result) {
    return c.json({ duplicated: false });
  }
  return c.json({ ...result, duplicated: true }, HTTP_STATUS.CREATED);
});

worksRoutes.post('/api/admin/works/epub', requireAdmin, async (c) => {
  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (contentLength > EPUB_UPLOAD_MAX_BYTES + 1024) {
    return c.json({ error: '文件大小超过上限（50MB）' }, HTTP_STATUS.BAD_REQUEST);
  }

  const form = await c.req.parseBody();
  const file = form['file'];
  if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
    return c.json({ error: '请选择要上传的 EPUB 文件' }, HTTP_STATUS.BAD_REQUEST);
  }

  const bytes = Buffer.from(await (file as File).arrayBuffer());
  if (bytes.length > EPUB_UPLOAD_MAX_BYTES) {
    return c.json({ error: '文件大小超过上限（50MB）' }, HTTP_STATUS.BAD_REQUEST);
  }

  const result = await worksService.createAdminEpubWork({
    fileName: (file as File).name,
    body: bytes,
    contentType: (file as File).type,
  });
  return c.json(result, HTTP_STATUS.CREATED);
});

worksRoutes.get('/api/admin/works', requireAdmin, validateAdminWorkListQuery, async (c) => {
  const data = await worksService.listAdminWorks(c.req.valid('query'));
  return c.json(data);
});

worksRoutes.get('/api/admin/works/:id', requireAdmin, async (c) => {
  const work = await worksService.getAdminWork(c.req.param('id'));
  return c.json(work);
});

worksRoutes.patch('/api/admin/works/:id', requireAdmin, validateUpdateWork, async (c) => {
  const work = await worksService.updateWork(c.req.param('id'), c.req.valid('json'));
  return c.json(work);
});

worksRoutes.post('/api/admin/works/:id/publish', requireAdmin, async (c) => {
  const work = await worksService.publishWork(c.req.param('id'));
  return c.json(work);
});

worksRoutes.post('/api/admin/works/:id/unpublish', requireAdmin, async (c) => {
  const work = await worksService.unpublishWork(c.req.param('id'));
  return c.json(work);
});

/** Retry / re-run the generation workflow — resume from the failed step, or re-run one step. */
worksRoutes.post('/api/admin/works/:id/workflow/retry', requireAdmin, validateRetryWorkflow, async (c) => {
  const work = await worksService.retryWorkflow(c.req.param('id'), c.req.valid('json'));
  return c.json(work);
});

worksRoutes.delete('/api/admin/works/:id', requireAdmin, async (c) => {
  await worksService.deleteWork(c.req.param('id'));
  return c.body(null, HTTP_STATUS.NO_CONTENT);
});

worksRoutes.get('/api/catalog/works', validateCatalogListQuery, async (c) => {
  const data = await worksService.listCatalogWorks(c.req.valid('query'));
  return c.json(data);
});

worksRoutes.get('/api/catalog/works/:id', async (c) => {
  const work = await worksService.getPublishedWork(c.req.param('id'));
  return c.json(work);
});
