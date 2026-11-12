import { Hono } from 'hono';

import { getWireRegistry } from '@/server/domains/llm/config/registry/service';
import { type AuthVariables, requireAdmin } from '@/server/infra/http/middleware/auth';

export const llmRegistryRoutes = new Hono<{ Variables: AuthVariables }>();

llmRegistryRoutes.get('/api/admin/llm/wire-registry', requireAdmin, async (c) => {
  return c.json(await getWireRegistry());
});
