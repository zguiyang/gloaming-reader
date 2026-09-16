import { pinoLogger } from 'hono-pino';
import type { Logger } from 'pino';

import { sanitizeHeaders } from '@/lib/log-redaction';
import { rootLogger } from '@/lib/logger';

export function createHttpLogger(pinoInstance: Logger = rootLogger) {
  return pinoLogger({
    pino: pinoInstance,
    http: {
      onReqBindings: (c) => ({
        req: {
          url: c.req.path,
          method: c.req.method,
          headers: sanitizeHeaders(c.req.header()),
        },
      }),
      onResBindings: (c) => ({
        res: {
          status: c.res.status,
          headers: sanitizeHeaders(c.res.headers),
        },
      }),
      onReqMessage: (c) => `→ ${c.req.method} ${c.req.path}`,
      onResMessage: (c) => `← ${c.req.method} ${c.req.path} ${c.res.status}`,
      onResLevel: (c) => {
        if (c.res.status >= 500) return 'error';
        if (c.res.status >= 400) return 'warn';
        return 'info';
      },
    },
  });
}

export const logger = createHttpLogger();
