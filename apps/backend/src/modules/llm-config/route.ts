import { Hono } from 'hono';

import { HTTP_STATUS } from '@/constants';
import { type AuthVariables, requireAdmin } from '@/middleware/auth';
import * as llmModelsService from '@/modules/llm-config/models/service';
import * as llmProvidersService from '@/modules/llm-config/providers/service';
import * as llmSettingsService from '@/modules/llm-config/settings/service';
import {
  validateCreateModel,
  validateCreateProvider,
  validateModelListQuery,
  validatePutSetting,
  validateTestProvider,
  validateUpdateModel,
  validateUpdateProvider,
} from '@/modules/llm-config/validator';

export const llmConfigRoutes = new Hono<{ Variables: AuthVariables }>();

llmConfigRoutes.get('/api/admin/llm/wire-registry', requireAdmin, async (c) => {
  return c.json(await llmModelsService.getWireRegistry());
});

llmConfigRoutes.get('/api/admin/llm/providers', requireAdmin, async (c) => {
  return c.json(await llmProvidersService.listProviders());
});

llmConfigRoutes.post('/api/admin/llm/providers', requireAdmin, validateCreateProvider, async (c) => {
  const provider = await llmProvidersService.createProvider(c.req.valid('json'));
  return c.json(provider, HTTP_STATUS.CREATED);
});

llmConfigRoutes.patch('/api/admin/llm/providers/:id', requireAdmin, validateUpdateProvider, async (c) => {
  const provider = await llmProvidersService.updateProvider(c.req.param('id'), c.req.valid('json'));
  return c.json(provider);
});

llmConfigRoutes.delete('/api/admin/llm/providers/:id', requireAdmin, async (c) => {
  await llmProvidersService.deleteProvider(c.req.param('id'));
  return c.body(null, HTTP_STATUS.NO_CONTENT);
});

llmConfigRoutes.post('/api/admin/llm/providers/:id/test', requireAdmin, validateTestProvider, async (c) => {
  const result = await llmProvidersService.testProvider(c.req.param('id'), c.req.valid('json'));
  return c.json(result);
});

llmConfigRoutes.post('/api/admin/llm/providers/:id/fetch-models', requireAdmin, async (c) => {
  return c.json(await llmProvidersService.fetchProviderModels(c.req.param('id')));
});

llmConfigRoutes.post('/api/admin/llm/providers/:id/balance', requireAdmin, async (c) => {
  return c.json(await llmProvidersService.queryProviderBalance(c.req.param('id')));
});

llmConfigRoutes.get('/api/admin/llm/models', requireAdmin, validateModelListQuery, async (c) => {
  return c.json(await llmModelsService.listModels(c.req.valid('query')));
});

llmConfigRoutes.post('/api/admin/llm/models', requireAdmin, validateCreateModel, async (c) => {
  const model = await llmModelsService.createModel(c.req.valid('json'));
  return c.json(model, HTTP_STATUS.CREATED);
});

llmConfigRoutes.patch('/api/admin/llm/models/:id', requireAdmin, validateUpdateModel, async (c) => {
  const model = await llmModelsService.updateModel(c.req.param('id'), c.req.valid('json'));
  return c.json(model);
});

llmConfigRoutes.delete('/api/admin/llm/models/:id', requireAdmin, async (c) => {
  await llmModelsService.deleteModel(c.req.param('id'));
  return c.body(null, HTTP_STATUS.NO_CONTENT);
});

llmConfigRoutes.get('/api/admin/llm/settings', requireAdmin, async (c) => {
  return c.json(await llmSettingsService.listSettings());
});

llmConfigRoutes.put('/api/admin/llm/settings/:key', requireAdmin, validatePutSetting, async (c) => {
  const setting = await llmSettingsService.putSetting(c.req.param('key'), c.req.valid('json'));
  return c.json(setting);
});
