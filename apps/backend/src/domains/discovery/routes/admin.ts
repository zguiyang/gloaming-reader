import { Hono } from 'hono';

import { validateSourceEnabledUpdate } from '@/domains/discovery/routes/validator';
import {
  getProjectGutenbergSourceStatus,
  requestProjectGutenbergSync,
  setProjectGutenbergSourceEnabled,
} from '@/domains/discovery/sync/admin';
import { type AuthVariables, requireAdmin } from '@/infra/http/middleware/auth';
import { HTTP_STATUS } from '@/shared/constants';

/**
 * Admin-only DiscoverySource controls. V1 exposes exactly the Project Gutenberg
 * source: status, enabled toggle, and a manual background sync trigger.
 */
export const discoveryAdminRoutes = new Hono<{ Variables: AuthVariables }>();

const PROJECT_GUTENBERG_SOURCE_PATH = '/api/admin/discovery/sources/project-gutenberg';

discoveryAdminRoutes.get(PROJECT_GUTENBERG_SOURCE_PATH, requireAdmin, async (c) => {
  return c.json(await getProjectGutenbergSourceStatus());
});

discoveryAdminRoutes.patch(PROJECT_GUTENBERG_SOURCE_PATH, requireAdmin, validateSourceEnabledUpdate, async (c) => {
  const { enabled } = c.req.valid('json');
  return c.json(await setProjectGutenbergSourceEnabled(enabled));
});

discoveryAdminRoutes.post(`${PROJECT_GUTENBERG_SOURCE_PATH}/sync`, requireAdmin, async (c) => {
  const accepted = await requestProjectGutenbergSync();
  return c.json(accepted, accepted.result === 'queued' ? HTTP_STATUS.ACCEPTED : HTTP_STATUS.OK);
});
