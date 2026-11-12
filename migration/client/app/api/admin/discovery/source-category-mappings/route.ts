import { z } from 'zod';

import { listSourceCategoryMappings } from '@/server/domains/discovery/categories';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

const sourceMappingListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
});

export async function GET(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    const url = new URL(request.url);
    const parsed = sourceMappingListQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'query',
          message: issue.message,
        })),
      );
    }
    return jsonOk(await listSourceCategoryMappings(parsed.data.page));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
