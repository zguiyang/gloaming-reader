import { jsonOk } from '@/server/infra/http/next-json';

export const dynamic = 'force-dynamic';

export async function GET() {
  return jsonOk({ status: 'live' });
}
