import { z } from 'zod';

import { SUPPORTED_LOCALES } from '@/i18n';
import { publicCategoryWriteSchema } from '@/shared/discovery';

import { updateManagedCategoryLabel } from '@/server/domains/discovery/categories';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

const managedCategoryWriteSchema = publicCategoryWriteSchema.extend({
  locale: z.enum(SUPPORTED_LOCALES),
});

type Ctx = { params: Promise<{ categoryId: string }> };

export async function PATCH(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    const { categoryId } = await context.params;
    const raw = await request.json().catch(() => null);
    const parsed = managedCategoryWriteSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }
    return jsonOk(await updateManagedCategoryLabel(categoryId, parsed.data));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
