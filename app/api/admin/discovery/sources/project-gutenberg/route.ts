import { discoverySourceEnabledUpdateSchema } from '@/shared/discovery';

import {
  getProjectGutenbergSourceStatus,
  setProjectGutenbergSourceEnabled,
} from '@/server/domains/discovery/sync/admin';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    return jsonOk(await getProjectGutenbergSourceStatus());
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}

export async function PATCH(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
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
    const { enabled } = parsed.data;
    return jsonOk(await setProjectGutenbergSourceEnabled(enabled));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
