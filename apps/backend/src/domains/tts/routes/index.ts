import { Hono } from 'hono';

import { ttsConfigRoutes } from '@/domains/tts/routes/config';
import { ttsDiagnosticsRoutes } from '@/domains/tts/routes/diagnostics';
import { ttsInvocationsRoutes } from '@/domains/tts/routes/invocations';
import { ttsVoicesRoutes } from '@/domains/tts/routes/voices';
import type { AuthVariables } from '@/infra/http/middleware/auth';

export const ttsRoutes = new Hono<{ Variables: AuthVariables }>();

ttsRoutes.route('/', ttsConfigRoutes);
ttsRoutes.route('/', ttsVoicesRoutes);
ttsRoutes.route('/', ttsDiagnosticsRoutes);
ttsRoutes.route('/', ttsInvocationsRoutes);
