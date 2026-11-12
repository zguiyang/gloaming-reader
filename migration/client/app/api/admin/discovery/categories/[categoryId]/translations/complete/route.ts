import { completeManagedCategoryTranslations } from '@/server/domains/discovery/categories';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ categoryId: string }> };

export async function POST(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    const { categoryId } = await context.params;
    return jsonOk(await completeManagedCategoryTranslations(categoryId));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
