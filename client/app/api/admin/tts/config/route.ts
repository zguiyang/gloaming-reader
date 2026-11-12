import { putTtsConfigBodySchema } from '@gloaming/shared/tts';

import { getConfig, putConfig } from '@/server/domains/tts/config/service';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    return jsonOk(await getConfig());
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}

export async function PUT(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);

    const raw = await request.json().catch(() => null);
    const parsed = putTtsConfigBodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }

    return jsonOk(await putConfig(parsed.data));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
