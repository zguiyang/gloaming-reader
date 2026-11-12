import { createLlmProviderBodySchema } from '@gloaming/shared/llm';

import * as userLlmConfig from '@/server/domains/llm/config/user/service';
import { rejectOwnerUserIdInPayload } from '@/server/domains/provider-scope';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    return jsonOk(await userLlmConfig.listUserProviders(identity.user.id));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);

    const raw = await request.json().catch(() => null);
    const parsed = createLlmProviderBodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }

    rejectOwnerUserIdInPayload(parsed.data as Record<string, unknown>);
    const provider = await userLlmConfig.createUserProvider(identity.user.id, parsed.data);
    return jsonOk(provider, { status: HTTP_STATUS.CREATED });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
