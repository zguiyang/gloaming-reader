import { listVoicePresets } from '@/server/domains/tts/config/service';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    return jsonOk(listVoicePresets());
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
