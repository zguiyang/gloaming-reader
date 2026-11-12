import { z } from 'zod';

import { suggestSourceCategoryMapping } from '@/server/domains/discovery/categories';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { AppError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';
import { HTTP_STATUS } from '@/server/shared/constants';

export const dynamic = 'force-dynamic';

const sourceMappingAnalysisSchema = z.object({
  enableThinking: z.boolean().default(false),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    const { id } = await context.params;
    const raw = await request.json().catch(() => ({}));
    const parsed = sourceMappingAnalysisSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }
    const result = await suggestSourceCategoryMapping(id, parsed.data);
    if (result.status !== 'review') {
      throw new AppError(HTTP_STATUS.CONFLICT, ERROR_CODES.DISCOVERY.SOURCE_CATEGORY_MAPPING_CONFLICT);
    }
    return jsonOk(result);
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
