import { completeUserTagTranslations } from '@/server/domains/library/tags/service';
import { jsonFromThrown, jsonOk } from '@/server/infra/http/next-json';
import { acquireAiRateLimit } from '@/server/infra/http/next-rate-limit';
import { assertAuthenticated, getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ tagId: string }> };

export async function POST(request: Request, context: Ctx) {
  let lease: { release: () => Promise<void> } | undefined;
  try {
    const identity = await getRequestIdentity(request);
    assertAuthenticated(identity);

    // One LLM call per missing locale, so bound it before invoking the model.
    const limited = await acquireAiRateLimit(request, 'tagTranslation', identity.user.id);
    if (!limited.ok) {
      return limited.response;
    }
    lease = limited.lease;

    const { tagId } = await context.params;
    return jsonOk(await completeUserTagTranslations(identity.user.id, tagId));
  } catch (error) {
    return jsonFromThrown(request, error);
  } finally {
    await lease?.release();
  }
}
