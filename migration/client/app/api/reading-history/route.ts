import { getReadingHistory } from '@/server/domains/reading/history/query';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);
    const actor = workReadActorFromIdentity(identity.user);
    const data = await getReadingHistory(actor, identity.user.id);
    return jsonOk(data);
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
