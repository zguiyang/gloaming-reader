import { getLibrary } from '@/server/domains/library/service';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const data = await getLibrary(identity.user.id);
    return jsonOk(data);
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
