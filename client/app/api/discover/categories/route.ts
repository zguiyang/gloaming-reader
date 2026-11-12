import { publicCategoryListQuerySchema } from '@gloaming/shared/discovery';

import { listPublicCategories } from '@/server/domains/discovery/categories';
import { resolveRequestLocale } from '@/server/infra/http/locale';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = publicCategoryListQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'query',
          message: issue.message,
        })),
      );
    }
    const { language } = parsed.data;
    return jsonOk(await listPublicCategories(resolveRequestLocale(request), language));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
