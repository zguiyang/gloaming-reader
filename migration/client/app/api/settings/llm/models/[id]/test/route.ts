import * as userLlmConfig from '@/server/domains/llm/config/user/service';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const { id } = await context.params;
    return jsonOk(await userLlmConfig.testUserModel(identity.user.id, id));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
