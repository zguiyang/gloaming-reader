import { testLlmProviderBodySchema } from '@/shared/llm';

import * as llmProvidersService from '@/server/domains/llm/config/providers/service';
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
    const parsed = testLlmProviderBodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }

    return jsonOk(await llmProvidersService.testProvider(id, parsed.data));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
