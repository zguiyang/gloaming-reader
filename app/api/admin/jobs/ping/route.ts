import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { enqueuePing } from '@/server/infra/queue';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    const id = await enqueuePing();
    return jsonOk({ id });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
