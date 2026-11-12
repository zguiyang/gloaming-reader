import { runSourceCategoryReconciliationBatch } from '@/server/domains/discovery/categories';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    const { id } = await context.params;
    return jsonOk(await runSourceCategoryReconciliationBatch(id, 100));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
