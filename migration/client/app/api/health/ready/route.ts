import { checkReadiness } from '@/server/infra/http/health';
import { jsonOk } from '@/server/infra/http/next-json';

export const dynamic = 'force-dynamic';

export async function GET() {
  const result = await checkReadiness();
  return jsonOk(
    { status: result.ready ? 'ready' : 'not_ready', dependencies: result.dependencies },
    { status: result.ready ? 200 : 503 },
  );
}
