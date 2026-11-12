import { discoverySourceEnabledUpdateSchema } from '@/shared/discovery';

import { setDiscoverySourceEnabled } from '@/server/domains/discovery/sources/service';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ sourceKey: string }> };

/** Admin: enable or disable a registered Discover source. */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);

    const { sourceKey } = await context.params;
    const raw = await request.json().catch(() => null);
    const parsed = discoverySourceEnabledUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }

    return jsonOk(await setDiscoverySourceEnabled(decodeURIComponent(sourceKey), parsed.data.enabled));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
