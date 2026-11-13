import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * Deliberately standalone: the repo's `vite.config.ts` pulls in the vinext and
 * Cloudflare plugins (RSC/SSR child environments), which vitest cannot boot as a
 * test harness. Test only the live tree — `archive/**` is legacy source whose
 * `@/...` aliases no longer resolve, and including it drowns real failures.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname),
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.spec.ts'],
    exclude: ['node_modules/**', 'archive/**', '.next/**', '.vinext/**', 'dist/**'],
  },
});
