import { Hono } from 'hono';

import { llmModelsRoutes } from '@/server/domains/llm/config/routes/models';
import { llmProvidersRoutes } from '@/server/domains/llm/config/routes/providers';
import { llmRegistryRoutes } from '@/server/domains/llm/config/routes/registry';
import { llmSettingsRoutes } from '@/server/domains/llm/config/routes/settings';
import { userLlmConfigRoutes } from '@/server/domains/llm/config/user/routes';
import type { AuthVariables } from '@/server/infra/http/middleware/auth';

export const llmConfigRoutes = new Hono<{ Variables: AuthVariables }>();

llmConfigRoutes.route('/', userLlmConfigRoutes);
llmConfigRoutes.route('/', llmRegistryRoutes);
llmConfigRoutes.route('/', llmProvidersRoutes);
llmConfigRoutes.route('/', llmModelsRoutes);
llmConfigRoutes.route('/', llmSettingsRoutes);
