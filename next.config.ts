import type { NextConfig } from 'next';

/**
 * N2 shell: match apps/web runtime expectations.
 * cacheComponents / partialPrefetching stay off until layouts are adapted for
 * Next 16 prerender rules (root layout uses cookies()/headers() for locale).
 */
const nextConfig: NextConfig = {
  reactCompiler: true,
  /** Cheerio → encoding-sniffer expects iconv-lite at bundle time. */
  serverExternalPackages: ['iconv-lite'],
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
