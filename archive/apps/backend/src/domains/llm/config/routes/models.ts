import { Hono } from 'hono';

import * as llmModelsService from '@/domains/llm/config/models/service';
import { validateCreateModel, validateModelListQuery, validateUpdateModel } from '@/domains/llm/config/validator';
import { type AuthVariables, requireAdmin } from '@/infra/http/middleware/auth';
import { HTTP_STATUS } from '@/shared/constants';

export const llmModelsRoutes = new Hono<{ Variables: AuthVariables }>();

llmModelsRoutes.get('/api/admin/llm/models', requireAdmin, validateModelListQuery, async (c) => {
  return c.json(await llmModelsService.listModels(c.req.valid('query')));
});

llmModelsRoutes.post('/api/admin/llm/models', requireAdmin, validateCreateModel, async (c) => {
  const model = await llmModelsService.createModel(c.req.valid('json'));
  return c.json(model, HTTP_STATUS.CREATED);
});

llmModelsRoutes.patch('/api/admin/llm/models/:id', requireAdmin, validateUpdateModel, async (c) => {
  const model = await llmModelsService.updateModel(c.req.param('id'), c.req.valid('json'));
  return c.json(model);
});

llmModelsRoutes.delete('/api/admin/llm/models/:id', requireAdmin, async (c) => {
  await llmModelsService.deleteModel(c.req.param('id'));
  return c.body(null, HTTP_STATUS.NO_CONTENT);
});
