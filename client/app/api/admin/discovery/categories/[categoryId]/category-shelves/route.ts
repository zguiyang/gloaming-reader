import { saveCategoryShelfTermsSchema } from '@gloaming/shared/discovery';

import { saveCategoryShelfTerms } from '@/server/domains/discovery/categories';
import { jsonFromThrown, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ categoryId: string }> };

export async function PUT(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    const { categoryId } = await context.params;
    const raw = await request.json().catch(() => null);
    const parsed = saveCategoryShelfTermsSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }
    await saveCategoryShelfTerms(categoryId, parsed.data.mappingIds);
    return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
