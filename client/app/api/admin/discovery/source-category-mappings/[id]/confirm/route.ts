import { sourceCategoryMappingConfirmSchema } from '@gloaming/shared/discovery';

import { confirmSourceCategoryMapping } from '@/server/domains/discovery/categories';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    const { id } = await context.params;
    const raw = await request.json().catch(() => null);
    const parsed = sourceCategoryMappingConfirmSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }
    const { revision, categoryIds } = parsed.data;
    return jsonOk(await confirmSourceCategoryMapping(id, revision, categoryIds));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
