import { putTtsConfigBodySchema } from '@gloaming/shared/tts';

import { getUserConfig, putUserConfig } from '@/server/domains/tts/config/user-service';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    return jsonOk(await getUserConfig(identity.user.id));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}

export async function PUT(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);

    const raw = await request.json().catch(() => null);
    const parsed = putTtsConfigBodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }

    return jsonOk(await putUserConfig(identity.user.id, parsed.data));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
