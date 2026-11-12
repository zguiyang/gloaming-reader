import { putDictionaryConfigBodySchema } from '@/shared/dictionary';

import { getDictionaryConfig, putDictionaryConfig } from '@/server/domains/dictionary/config/service';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { assertAdmin, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);
    return jsonOk(await getDictionaryConfig());
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}

export async function PUT(request: Request) {
  try {
    const identity = await getRequestIdentity(request);
    assertAdmin(identity);

    const raw = await request.json().catch(() => null);
    const parsed = putDictionaryConfigBodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }

    return jsonOk(await putDictionaryConfig(parsed.data));
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
