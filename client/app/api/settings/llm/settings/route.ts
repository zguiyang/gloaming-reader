import * as userLlmConfig from '@/server/domains/llm/config/user/service';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    return jsonOk(await userLlmConfig.listUserSettings(identity.user.id));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
