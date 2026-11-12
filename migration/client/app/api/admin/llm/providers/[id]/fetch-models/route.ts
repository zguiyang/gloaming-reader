import * as llmProvidersService from '@/server/domains/llm/config/providers/service';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    const { id } = await context.params;
    return jsonOk(await llmProvidersService.fetchProviderModels(id));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
