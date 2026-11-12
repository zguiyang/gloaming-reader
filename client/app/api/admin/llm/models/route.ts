import { createLlmModelBodySchema, llmModelListQuerySchema } from '@/shared/llm';

import * as llmModelsService from '@/server/domains/llm/config/models/service';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';
import { HTTP_STATUS } from '@/server/shared/constants';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);

    const url = new URL(request.url);
    const parsed = llmModelListQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'query',
          message: issue.message,
        })),
      );
    }

    return jsonOk(await llmModelsService.listModels(parsed.data));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);

    const raw = await request.json().catch(() => null);
    const parsed = createLlmModelBodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }

    const model = await llmModelsService.createModel(parsed.data);
    return jsonOk(model, { status: HTTP_STATUS.CREATED });
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
