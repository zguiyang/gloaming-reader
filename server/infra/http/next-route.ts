import { jsonFromThrown } from '@/server/infra/http/next-json';

type ApiHandler<Args extends unknown[]> = (request: Request, ...args: Args) => Promise<Response>;

/**
 * Wrap a route handler so any thrown error goes through the shared error
 * contract. Handlers with extra catch-side logic should keep their own
 * try/catch instead.
 */
export function withApiError<Args extends unknown[]>(handler: ApiHandler<Args>): ApiHandler<Args> {
  return async (request, ...args) => {
    try {
      return await handler(request, ...args);
    } catch (error) {
      return jsonFromThrown(request, error);
    }
  };
}
