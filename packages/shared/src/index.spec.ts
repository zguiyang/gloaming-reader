import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import * as shared from './index.ts';

const ACCEPTED_MODULES = [
  'ai-invocations',
  'assist',
  'auth',
  'content-assets',
  'conversations',
  'dictionary',
  'llm',
  'pagination',
  'reader',
  'reading-history',
  'reading-stats',
  'recommendations',
  'shelf',
  'taxonomy',
  'translate',
  'tts',
  'tts-invocations',
  'works',
] as const;

describe('shared root facade', () => {
  it('keeps a compatibility root and declares official module exports', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      exports: Record<string, string>;
    };
    const indexSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

    expect(packageJson.exports['.']).toBe('./src/index.ts');
    for (const moduleName of ACCEPTED_MODULES) {
      expect(packageJson.exports[`./${moduleName}`]).toBe(`./src/${moduleName}/index.ts`);
    }
    expect(Object.keys(packageJson.exports).sort()).toEqual(
      ['.', ...ACCEPTED_MODULES.map((name) => `./${name}`)].sort(),
    );
    expect(indexSource).not.toMatch(/export\s+\*/);
    expect(indexSource).not.toMatch(/from ['"]\.\/api\//);
  });

  it('exposes work contracts but not backend workflow switches', () => {
    expect(shared.workSchema).toBeDefined();
    expect(shared.adminWorkflowPolicySchema).toBeDefined();
    expect(shared).not.toHaveProperty('WORKFLOW_AUTO_CHAIN');
    expect(shared).not.toHaveProperty('TTS_STEP_ENABLED');
  });
});

describe('shared module entrypoints', () => {
  it('uses explicit exports and does not star-reexport internals', () => {
    for (const moduleName of ACCEPTED_MODULES) {
      const source = readFileSync(new URL(`./${moduleName}/index.ts`, import.meta.url), 'utf8');
      expect(source).not.toMatch(/export\s+\*/);
      expect(source).toMatch(/export\s*\{/);
    }
  });
});
