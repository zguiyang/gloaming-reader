import { readerAudioManifestQuerySchema } from '@/shared/reader';

import { getReaderAudioManifest } from '@/server/domains/reader-audio/service';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { jsonFromThrown, jsonOk, jsonValidationError } from '@/server/infra/http/next-json';
import { getRequestIdentity } from '@/server/infra/http/next-session';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ partId: string }> };

export async function GET(request: Request, context: Ctx) {
  try {
    const { partId } = await context.params;
    const identity = await getRequestIdentity(request);
    const url = new URL(request.url);
    const parsed = readerAudioManifestQuerySchema.safeParse({ role: url.searchParams.get('role') ?? undefined });
    if (!parsed.success) {
      return jsonValidationError(
        request,
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || 'query',
          message: issue.message,
        })),
      );
    }

    const actor = workReadActorFromIdentity(identity.user);
    const manifest = await getReaderAudioManifest(actor, partId, parsed.data.role);
    return jsonOk(manifest);
  } catch (error) {
    return jsonFromThrown(request, error);
  }
}
