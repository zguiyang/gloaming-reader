import { categorySourceRecordListQuerySchema } from '@/shared/discovery';

import { listManagedCategorySourceRecords } from '@/server/domains/discovery/categories';
import { resolveRequestLocale } from '@/server/infra/http/locale';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ categoryId: string }> };

export async function GET(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    const { categoryId } = await context.params;
    const url = new URL(request.url);
    const parsed = categorySourceRecordListQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'query',
          message: issue.message,
        })),
      );
    }
    return jsonOk(await listManagedCategorySourceRecords(categoryId, parsed.data, resolveRequestLocale(request)));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
