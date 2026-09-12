import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import eslintConfigPrettier from 'eslint-config-prettier';
import boundaries from 'eslint-plugin-boundaries';
import importX from 'eslint-plugin-import-x';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const nodeSourceFiles = [
  'packages/shared/**/*.{js,mjs,ts}',
  'packages/db/**/*.{js,mjs,ts}',
  'apps/backend/**/*.{js,mjs,ts}',
];

/** Node packages/apps TypeScript files covered by a TSConfig project (excludes shared *.spec.ts). */
const typedNodeFiles = [
  'packages/shared/src/**/*.ts',
  'packages/db/src/**/*.ts',
  'apps/backend/src/**/*.ts',
  'apps/backend/tests/**/*.ts',
];

const nextFiles = ['apps/web/**/*.{js,jsx,mjs,ts,tsx}'];

const typedNextFiles = ['apps/web/**/*.{ts,tsx}'];

const allSourceFiles = [...nodeSourceFiles, ...nextFiles];

const namingConventionBase = [
  {
    selector: 'default',
    format: ['camelCase'],
    leadingUnderscore: 'allow',
    trailingUnderscore: 'allow',
  },
  {
    selector: 'variable',
    filter: {
      regex: '^__',
      match: true,
    },
    format: null,
  },
  { selector: 'typeLike', format: ['PascalCase'] },
  {
    selector: 'function',
    format: ['camelCase', 'PascalCase'],
    leadingUnderscore: 'allow',
  },
  {
    selector: 'variable',
    format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
    leadingUnderscore: 'allow',
  },
  { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
  { selector: 'import', format: ['camelCase', 'PascalCase'] },
  { selector: 'objectLiteralProperty', format: null },
  {
    selector: 'typeProperty',
    format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
    leadingUnderscore: 'allow',
  },
];

/** Scope Next flat configs to apps/web only (they default to repo-wide globs). */
function scopeToWeb(configs) {
  return configs.map((config) => ({
    ...config,
    files: nextFiles,
  }));
}

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/.next/**',
    '**/out/**',
    '**/build/**',
    '**/*.tsbuildinfo',
    'apps/web/next-env.d.ts',
    '.trellis/**',
    '.pnpm-store/**',
    '**/vitest.config.ts',
    '**/postcss.config.mjs',
    '**/drizzle.config.ts',
  ]),

  {
    files: allSourceFiles,
    plugins: {
      'simple-import-sort': simpleImportSort,
      'import-x': importX,
      boundaries,
      '@typescript-eslint': tseslint.plugin,
    },
    settings: {
      'boundaries/elements': [
        { type: 'web', pattern: 'apps/web/**' },
        { type: 'backend', pattern: 'apps/backend/**' },
        { type: 'shared', pattern: 'packages/shared/**' },
        { type: 'db', pattern: 'packages/db/**' },
      ],
    },
    rules: {
      'simple-import-sort/imports': [
        'error',
        {
          groups: [['^\\u0000'], ['^node:'], ['^@?\\w'], ['^@gloaming/'], ['^@/'], ['^\\.']],
        },
      ],
      'simple-import-sort/exports': 'error',
      'import-x/no-cycle': 'error',
      'import-x/no-unused-modules': 'warn',
      'import-x/order': 'off',
      'import/order': 'off',
      'sort-imports': 'off',
      // Ban .js/.mjs/.cjs/.jsx suffixes in TS/TSX imports (targets are almost always TS modules).
      // Real .js modules are rare — use eslint-disable-next-line with a one-line reason if needed.
      // Complements: allowImportingTsExtensions (shared tsconfig) + vscode importModuleSpecifierEnding: minimal.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '\\.(js|mjs|cjs|jsx)$',
              message: 'Do not use JavaScript extensions in TypeScript imports; use .ts/.tsx or omit the extension.',
            },
          ],
        },
      ],
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          policies: [
            {
              from: { element: { type: 'web' } },
              disallow: { to: { element: { type: 'backend' } } },
            },
            {
              from: { element: { type: 'backend' } },
              disallow: { to: { element: { type: 'web' } } },
            },
            {
              from: { element: { type: 'shared' } },
              disallow: { to: { element: { types: { anyOf: ['web', 'backend', 'db'] } } } },
            },
            {
              from: { element: { type: 'db' } },
              disallow: { to: { element: { types: { anyOf: ['web', 'backend', 'shared'] } } } },
            },
          ],
        },
      ],
      '@typescript-eslint/naming-convention': ['error', ...namingConventionBase],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportNamedDeclaration[exportKind="value"] > ExportSpecifier[exportKind="type"]',
          message:
            'Split mixed type and value exports into separate `export type { ... }` and `export { ... }` declarations.',
        },
      ],
    },
  },

  {
    files: nodeSourceFiles,
    extends: [js.configs.recommended, ...tseslint.configs.recommended, eslintConfigPrettier],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  {
    files: typedNodeFiles,
    ignores: ['packages/shared/src/**/*.spec.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-exports': [
        'error',
        {
          fixMixedExportsWithInlineTypeSpecifier: false,
        },
      ],
    },
  },

  ...scopeToWeb(nextVitals),
  ...scopeToWeb(nextTs),
  {
    files: nextFiles,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      next: {
        rootDir: 'apps/web',
      },
    },
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        ...namingConventionBase,
        {
          selector: 'variable',
          types: ['boolean'],
          format: ['camelCase', 'PascalCase'],
          prefix: ['is', 'has', 'can', 'should', 'enable'],
        },
      ],
    },
  },
  {
    files: typedNextFiles,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      next: {
        rootDir: 'apps/web',
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-exports': [
        'error',
        {
          fixMixedExportsWithInlineTypeSpecifier: false,
        },
      ],
    },
  },
  {
    files: nextFiles,
    ...eslintConfigPrettier,
  },
]);
