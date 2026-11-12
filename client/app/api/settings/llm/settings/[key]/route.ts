import { putLlmAppSettingBodySchema } from '@/shared/llm';

import * as userLlmConfig from '@/server/domains/llm/config/user/service';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ key: string }> };

export async function PUT(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const { key } = await context.params;

    const raw = await request.json().catch(() => null);
    const parsed = putLlmAppSettingBodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }

    return jsonOk(await userLlmConfig.putUserSetting(identity.user.id, key, parsed.data));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
