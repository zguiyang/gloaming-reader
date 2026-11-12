import { sourceCategoryMappingRevisionSchema } from '@gloaming/shared/discovery';

import { ignoreSourceCategoryMapping } from '@/server/domains/discovery/categories';
import { jsonFromThrown, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    const { id } = await context.params;
    const raw = await request.json().catch(() => null);
    const parsed = sourceCategoryMappingRevisionSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }
    await ignoreSourceCategoryMapping(id, parsed.data.revision);
    return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
