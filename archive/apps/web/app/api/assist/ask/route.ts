export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Streaming BFF for assist ask.
 * Generic `/api/*` rewrites can buffer SSE; this handler pipes the Hono body through.
 */
export async function POST(request: Request) {
  const upstreamUrl = `${process.env.API_INTERNAL_URL}/api/assist/ask`;
  const headers = new Headers();
  headers.set('Accept', 'text/event-stream');
  headers.set('Content-Type', request.headers.get('Content-Type') ?? 'application/json');
  const cookie = request.headers.get('cookie');
  if (cookie) {
    headers.set('cookie', cookie);
  }
  // Avoid upstream/proxy compression buffers that hold SSE until the response ends.
  headers.set('Accept-Encoding', 'identity');

  const upstream = await fetch(upstreamUrl, {
    method: 'POST',
    headers,
    body: await request.text(),
    signal: request.signal,
  });

  if (!upstream.body) {
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' },
    });
  }

  const responseHeaders = new Headers();
  responseHeaders.set('Content-Type', upstream.headers.get('Content-Type') ?? 'text/event-stream; charset=utf-8');
  responseHeaders.set('Cache-Control', 'no-cache, no-transform');
  responseHeaders.set('Connection', 'keep-alive');
  responseHeaders.set('X-Accel-Buffering', 'no');

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
