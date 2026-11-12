import * as llmSettingsService from '@/server/domains/llm/config/settings/service';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    return jsonOk(await llmSettingsService.listSettings());
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
