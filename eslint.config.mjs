import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier';

import clientEslint from './client/eslint.config.mjs';

/**
 * Root ESLint: repo tooling + product tree (`client/`). Legacy tree under `archive/` is not linted by default.
 */
const rootToolingFiles = ['eslint.config.mjs', 'prettier.config.js', 'commitlint.config.js'];

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/.next/**',
    '**/out/**',
    '**/build/**',
    '**/*.tsbuildinfo',
    '.trellis/**',
    '.pnpm-store/**',
    'archive/**',
    '.agents/**',
  ]),

  ...clientEslint,

  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  {
    files: rootToolingFiles,
    extends: [js.configs.recommended, eslintConfigPrettier],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
  },
]);
