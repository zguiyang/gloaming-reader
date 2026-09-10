import { Hono } from 'hono';

import { HTTP_STATUS } from '@/constants';
import { type AuthVariables, requireAdmin } from '@/middleware/auth';
import * as assetManagementService from '@/modules/asset-management/service';
import { validateAssetCleanupBody, validateAssetObjectListQuery } from '@/modules/asset-management/validator';

export const assetManagementRoutes = new Hono<{ Variables: AuthVariables }>();

assetManagementRoutes.post('/api/admin/assets/scan', requireAdmin, async (c) => {
  const report = await assetManagementService.scanAssets();
  return c.json(report);
});

assetManagementRoutes.get(
  '/api/admin/assets/scans/:scanId/objects',
  requireAdmin,
  validateAssetObjectListQuery,
  async (c) => {
    const data = await assetManagementService.listScanObjects(c.req.param('scanId'), c.req.valid('query'));
    return c.json(data);
  },
);

assetManagementRoutes.post(
  '/api/admin/assets/scans/:scanId/cleanup',
  requireAdmin,
  validateAssetCleanupBody,
  async (c) => {
    const result = await assetManagementService.enqueueOrphanCleanup(c.req.param('scanId'));
    return c.json(result, HTTP_STATUS.ACCEPTED);
  },
);

assetManagementRoutes.get('/api/admin/assets/cleanup-jobs/:jobId', requireAdmin, async (c) => {
  const job = await assetManagementService.getCleanupJob(c.req.param('jobId'));
  return c.json(job);
});

assetManagementRoutes.post(
  '/api/admin/assets/cleanup-jobs/:jobId/retry',
  requireAdmin,
  validateAssetCleanupBody,
  async (c) => {
    const result = await assetManagementService.retryCleanupJob(c.req.param('jobId'));
    return c.json(result, HTTP_STATUS.ACCEPTED);
  },
);
