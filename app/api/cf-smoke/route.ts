/**
 * P4-V1 Workers smoke: no DB, Redis, or auth. Safe for Preview CPU checks.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return Response.json({
    ok: true,
    path: '/api/cf-smoke',
    runtime: 'vinext-worker',
    method: request.method,
    timestamp: new Date().toISOString(),
  });
}
