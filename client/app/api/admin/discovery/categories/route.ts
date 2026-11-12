import { z } from 'zod';

import { SUPPORTED_LOCALES } from '@gloaming/i18n';
import { publicCategoryWriteSchema } from '@gloaming/shared/discovery';

import { createManagedCategory, listManagedCategories } from '@/server/domains/discovery/categories';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';

export const dynamic = 'force-dynamic';

const managedCategoryWriteSchema = publicCategoryWriteSchema.extend({
  locale: z.enum(SUPPORTED_LOCALES),
});

export async function GET(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    return jsonOk(await listManagedCategories());
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
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
    return jsonOk(await createManagedCategory(parsed.data), { status: HTTP_STATUS.CREATED });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
