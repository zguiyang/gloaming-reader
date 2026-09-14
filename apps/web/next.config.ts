import type { NextConfig } from 'next';

/**
 * Most `/api/*` paths are rewritten in `proxy.ts` to the Hono API (`API_INTERNAL_URL`)
 * so session cookies stay first-party on the web origin. Required — no localhost default.
 * Streaming exceptions (e.g. `/api/assist/ask`) stay on Next Route Handlers — see `proxy.ts`.
 */
if (!process.env.API_INTERNAL_URL?.trim()) {
  throw new Error('API_INTERNAL_URL is required (Hono API origin for Next /api rewrites)');
}

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ['@gloaming/i18n', '@gloaming/shared'],
  output: 'standalone',
};

export default nextConfig;
