import { Hono } from 'hono';

import { llmModelsRoutes } from '@/domains/llm/config/routes/models';
import { llmProvidersRoutes } from '@/domains/llm/config/routes/providers';
import { llmRegistryRoutes } from '@/domains/llm/config/routes/registry';
import { llmSettingsRoutes } from '@/domains/llm/config/routes/settings';
import type { AuthVariables } from '@/infra/http/middleware/auth';

export const llmConfigRoutes = new Hono<{ Variables: AuthVariables }>();

llmConfigRoutes.route('/', llmRegistryRoutes);
llmConfigRoutes.route('/', llmProvidersRoutes);
llmConfigRoutes.route('/', llmModelsRoutes);
llmConfigRoutes.route('/', llmSettingsRoutes);
