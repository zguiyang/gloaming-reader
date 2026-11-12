import { serve } from '@hono/node-server';

import app from '@/app';
import { env } from '@/infra/config/env';
import { serverLogger } from '@/infra/logging/logger';

serverLogger.info(`Listening on http://${env.HOST}:${env.PORT}`);

serve({
  fetch: app.fetch,
  port: env.PORT,
  // Prefer dual-stack; binding `localhost` can be IPv6-only on macOS.
  hostname: env.HOST === 'localhost' ? '0.0.0.0' : env.HOST,
});
