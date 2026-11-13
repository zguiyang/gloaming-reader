import { checkReadiness } from '@/server/infra/http/health';
import { jsonOk } from '@/server/infra/http/next-json';
import { serverLogger } from '@/server/infra/logging/logger';

export const dynamic = 'force-dynamic';

/**
 * Public readiness probe. The body only reports the aggregate state — which
 * dependency (postgres vs redis) is down stays in server logs so anonymous
 * callers cannot map the data plane.
 */
export async function GET() {
  const result = await checkReadiness();
  if (!result.ready) {
    serverLogger.warn({ dependencies: result.dependencies }, 'readiness check failed');
  }
  return jsonOk({ status: result.ready ? 'ready' : 'not_ready' }, { status: result.ready ? 200 : 503 });
}
