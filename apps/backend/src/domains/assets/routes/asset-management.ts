import { Hono } from 'hono';

import * as assetCleanupService from '@/domains/assets/cleanup/service';
import { validateAssetCleanupBody } from '@/domains/assets/management/validator';
import * as assetScanService from '@/domains/assets/scan/service';
import { type AuthVariables, requireAdmin } from '@/infra/http/middleware/auth';
import { HTTP_STATUS } from '@/shared/constants';

export const assetManagementRoutes = new Hono<{ Variables: AuthVariables }>();

assetManagementRoutes.post('/api/admin/assets/scan', requireAdmin, async (c) => {
  const report = await assetScanService.scanAssets();
  return c.json(report);
});

assetManagementRoutes.post(
  '/api/admin/assets/scans/:scanId/cleanup',
  requireAdmin,
  validateAssetCleanupBody,
  async (c) => {
    const result = await assetCleanupService.enqueueOrphanCleanup(c.req.param('scanId'));
    return c.json(result, HTTP_STATUS.ACCEPTED);
  },
);

assetManagementRoutes.get('/api/admin/assets/cleanup-jobs/:jobId', requireAdmin, async (c) => {
  const job = await assetCleanupService.getCleanupJob(c.req.param('jobId'));
  return c.json(job);
});

assetManagementRoutes.post(
  '/api/admin/assets/cleanup-jobs/:jobId/retry',
  requireAdmin,
  validateAssetCleanupBody,
  async (c) => {
    const result = await assetCleanupService.retryCleanupJob(c.req.param('jobId'));
    return c.json(result, HTTP_STATUS.ACCEPTED);
  },
);
