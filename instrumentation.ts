import type { Instrumentation } from 'next';

/**
 * Next server boot hook (Node runtime only). Probes DB/Redis and writes a short
 * structured startup trail so production logs show env → postgres → redis → ready.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  const { reportRuntimeBoot } = await import('@/server/infra/logging/runtime-boot');
  await reportRuntimeBoot('app');
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  const { createLogger } = await import('@/server/infra/logging/logger');
  createLogger('Server', { service: 'app' }).error(
    {
      err: error,
      path: request.path,
      method: request.method,
      routerKind: context.routerKind,
      routePath: context.routePath,
      routeType: context.routeType,
    },
    'Unhandled Next.js request error',
  );
};
