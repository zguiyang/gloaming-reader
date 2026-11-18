import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

/** Standalone Vitest config for the live tree. */
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname),
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.spec.ts'],
    exclude: ['node_modules/**', '.next/**', 'dist/**'],
  },
});
