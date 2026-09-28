import { Hono } from 'hono';

import * as userLlmConfig from '@/domains/llm/config/user/service';
import {
  validateCreateModel,
  validateCreateProvider,
  validateModelListQuery,
  validatePutSetting,
  validateUpdateModel,
  validateUpdateProvider,
} from '@/domains/llm/config/validator';
import { rejectOwnerUserIdInPayload } from '@/domains/provider-scope';
import { type AuthVariables, requireAuth } from '@/infra/http/middleware/auth';
import { HTTP_STATUS } from '@/shared/constants';

export const userLlmConfigRoutes = new Hono<{ Variables: AuthVariables }>();

userLlmConfigRoutes.get('/api/settings/llm/providers', requireAuth, async (c) => {
  const user = c.get('user')!;
  return c.json(await userLlmConfig.listUserProviders(user.id));
});

userLlmConfigRoutes.post('/api/settings/llm/providers', requireAuth, validateCreateProvider, async (c) => {
  const user = c.get('user')!;
  rejectOwnerUserIdInPayload(c.req.valid('json') as Record<string, unknown>);
  const provider = await userLlmConfig.createUserProvider(user.id, c.req.valid('json'));
  return c.json(provider, HTTP_STATUS.CREATED);
});

userLlmConfigRoutes.patch('/api/settings/llm/providers/:id', requireAuth, validateUpdateProvider, async (c) => {
  const user = c.get('user')!;
  rejectOwnerUserIdInPayload(c.req.valid('json') as Record<string, unknown>);
  const provider = await userLlmConfig.updateUserProvider(user.id, c.req.param('id'), c.req.valid('json'));
  return c.json(provider);
});

userLlmConfigRoutes.delete('/api/settings/llm/providers/:id', requireAuth, async (c) => {
  const user = c.get('user')!;
  await userLlmConfig.deleteUserProvider(user.id, c.req.param('id'));
  return c.body(null, HTTP_STATUS.NO_CONTENT);
});

userLlmConfigRoutes.get('/api/settings/llm/models', requireAuth, validateModelListQuery, async (c) => {
  const user = c.get('user')!;
  return c.json(await userLlmConfig.listUserModels(user.id, c.req.valid('query')));
});

userLlmConfigRoutes.post('/api/settings/llm/models', requireAuth, validateCreateModel, async (c) => {
  const user = c.get('user')!;
  const model = await userLlmConfig.createUserModel(user.id, c.req.valid('json'));
  return c.json(model, HTTP_STATUS.CREATED);
});

userLlmConfigRoutes.patch('/api/settings/llm/models/:id', requireAuth, validateUpdateModel, async (c) => {
  const user = c.get('user')!;
  const model = await userLlmConfig.updateUserModel(user.id, c.req.param('id'), c.req.valid('json'));
  return c.json(model);
});

userLlmConfigRoutes.delete('/api/settings/llm/models/:id', requireAuth, async (c) => {
  const user = c.get('user')!;
  await userLlmConfig.deleteUserModel(user.id, c.req.param('id'));
  return c.body(null, HTTP_STATUS.NO_CONTENT);
});

userLlmConfigRoutes.get('/api/settings/llm/settings', requireAuth, async (c) => {
  const user = c.get('user')!;
  return c.json(await userLlmConfig.listUserSettings(user.id));
});

userLlmConfigRoutes.put('/api/settings/llm/settings/:key', requireAuth, validatePutSetting, async (c) => {
  const user = c.get('user')!;
  const setting = await userLlmConfig.putUserSetting(user.id, c.req.param('key'), c.req.valid('json'));
  return c.json(setting);
});
