import { organizeUnassignedCategoryShelves } from '@/server/domains/discovery/categories';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    return jsonOk(await organizeUnassignedCategoryShelves());
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
