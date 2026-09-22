import { Hono } from 'hono';

import * as llmProvidersService from '@/domains/llm/config/providers/service';
import { validateCreateProvider, validateTestProvider, validateUpdateProvider } from '@/domains/llm/config/validator';
import { type AuthVariables, requireAdmin } from '@/infra/http/middleware/auth';
import { HTTP_STATUS } from '@/shared/constants';

export const llmProvidersRoutes = new Hono<{ Variables: AuthVariables }>();

llmProvidersRoutes.get('/api/admin/llm/providers', requireAdmin, async (c) => {
  return c.json(await llmProvidersService.listProviders());
});

llmProvidersRoutes.post('/api/admin/llm/providers', requireAdmin, validateCreateProvider, async (c) => {
  const provider = await llmProvidersService.createProvider(c.req.valid('json'));
  return c.json(provider, HTTP_STATUS.CREATED);
});

llmProvidersRoutes.patch('/api/admin/llm/providers/:id', requireAdmin, validateUpdateProvider, async (c) => {
  const provider = await llmProvidersService.updateProvider(c.req.param('id'), c.req.valid('json'));
  return c.json(provider);
});

llmProvidersRoutes.delete('/api/admin/llm/providers/:id', requireAdmin, async (c) => {
  await llmProvidersService.deleteProvider(c.req.param('id'));
  return c.body(null, HTTP_STATUS.NO_CONTENT);
});

llmProvidersRoutes.post('/api/admin/llm/providers/:id/test', requireAdmin, validateTestProvider, async (c) => {
  const result = await llmProvidersService.testProvider(c.req.param('id'), c.req.valid('json'));
  return c.json(result);
});

llmProvidersRoutes.post('/api/admin/llm/providers/:id/fetch-models', requireAdmin, async (c) => {
  return c.json(await llmProvidersService.fetchProviderModels(c.req.param('id')));
});

llmProvidersRoutes.post('/api/admin/llm/providers/:id/balance', requireAdmin, async (c) => {
  return c.json(await llmProvidersService.queryProviderBalance(c.req.param('id')));
});
