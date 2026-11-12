import { Hono } from 'hono';

import { ttsConfigRoutes } from '@/server/domains/tts/routes/config';
import { ttsDiagnosticsRoutes } from '@/server/domains/tts/routes/diagnostics';
import { ttsInvocationsRoutes } from '@/server/domains/tts/routes/invocations';
import { ttsUserConfigRoutes } from '@/server/domains/tts/routes/user-config';
import { ttsVoicesRoutes } from '@/server/domains/tts/routes/voices';
import type { AuthVariables } from '@/server/infra/http/middleware/auth';

export const ttsRoutes = new Hono<{ Variables: AuthVariables }>();

ttsRoutes.route('/', ttsConfigRoutes);
ttsRoutes.route('/', ttsUserConfigRoutes);
ttsRoutes.route('/', ttsVoicesRoutes);
ttsRoutes.route('/', ttsDiagnosticsRoutes);
ttsRoutes.route('/', ttsInvocationsRoutes);
