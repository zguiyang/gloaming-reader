import { Hono } from 'hono';

import {
  enqueuePartAudio,
  enqueueWorkAudio,
  getPartAudio,
  getWorkAudio,
  validateGeneratePartAudio,
  validateGenerateWorkAudio,
  validateWorkAudioQuery,
} from '@/domains/assets';
import { getAdminWork } from '@/domains/works/admin';
import { type AuthVariables, requireAdmin } from '@/infra/http/middleware/auth';
import { NotFoundError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

export const contentAssetsRoutes = new Hono<{ Variables: AuthVariables }>();

async function assertCatalogPart(workId: string, partId: string): Promise<void> {
  const work = await getAdminWork(workId);
  if (!work.parts.some((part) => part.id === partId)) {
    throw new NotFoundError(ERROR_CODES.NOT_FOUND.PART);
  }
}

contentAssetsRoutes.get('/api/admin/catalog/works/:workId/parts/:partId/audio', requireAdmin, async (c) => {
  const { workId, partId } = c.req.param();
  await assertCatalogPart(workId, partId);
  return c.json(await getPartAudio(partId));
});

contentAssetsRoutes.post(
  '/api/admin/catalog/works/:workId/parts/:partId/audio/generate',
  requireAdmin,
  validateGeneratePartAudio,
  async (c) => {
    const { workId, partId } = c.req.param();
    await assertCatalogPart(workId, partId);
    return c.json(await enqueuePartAudio(partId, c.req.valid('json')));
  },
);

contentAssetsRoutes.get('/api/admin/catalog/works/:workId/audio', requireAdmin, validateWorkAudioQuery, async (c) => {
  const { role } = c.req.valid('query');
  const workId = c.req.param('workId');
  await getAdminWork(workId);
  return c.json(await getWorkAudio(workId, role));
});

contentAssetsRoutes.post(
  '/api/admin/catalog/works/:workId/audio/generate',
  requireAdmin,
  validateGenerateWorkAudio,
  async (c) => {
    const workId = c.req.param('workId');
    await getAdminWork(workId);
    return c.json(await enqueueWorkAudio(workId, c.req.valid('json')));
  },
);
