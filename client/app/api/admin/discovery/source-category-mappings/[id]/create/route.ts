import { z } from 'zod';

import { SUPPORTED_LOCALES } from '@gloaming/i18n';
import { sourceCategoryMappingRevisionSchema } from '@gloaming/shared/discovery';

import { confirmNewSourceCategory } from '@/server/domains/discovery/categories';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

const sourceMappingCreateSchema = sourceCategoryMappingRevisionSchema.extend({
  locale: z.enum(SUPPORTED_LOCALES),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    const { id } = await context.params;
    const raw = await request.json().catch(() => null);
    const parsed = sourceMappingCreateSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }
    const { revision, locale } = parsed.data;
    return jsonOk(await confirmNewSourceCategory(id, revision, locale));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
