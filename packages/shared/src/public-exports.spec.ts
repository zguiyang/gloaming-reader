import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import * as works from './works/index.ts';

const ACCEPTED_MODULES = [
  'ai-invocations',
  'assets',
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

describe('shared package exports', () => {
  it('declares only official module subpaths', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      exports: Record<string, string>;
    };

    expect(packageJson.exports['.']).toBeUndefined();
    expect(Object.keys(packageJson.exports).sort()).toEqual(ACCEPTED_MODULES.map((name) => `./${name}`).sort());
    for (const moduleName of ACCEPTED_MODULES) {
      expect(packageJson.exports[`./${moduleName}`]).toBe(`./src/${moduleName}/index.ts`);
    }
    expect(
      Object.values(packageJson.exports).some((target) => target.includes('/src/') && !target.endsWith('/index.ts')),
    ).toBe(false);
    expect(Object.keys(packageJson.exports).some((key) => key.includes('/src/'))).toBe(false);
  });
});

describe('shared module entrypoints', () => {
  it('uses explicit named exports from each module and does not star-reexport', () => {
    for (const moduleName of ACCEPTED_MODULES) {
      const source = readFileSync(new URL(`./${moduleName}/index.ts`, import.meta.url), 'utf8');
      expect(source).not.toMatch(/export\s+\*/);
      expect(source).toMatch(/export\s*\{/);
      expect(source).not.toMatch(/from ['"]@gloaming\/shared['"]/);
      expect(source).not.toMatch(/from ['"]\.\.\/index\.ts['"]/);
      for (const fromMatch of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const specifier = fromMatch[1];
        expect(specifier.startsWith('./')).toBe(true);
        expect(specifier.includes('/../')).toBe(false);
      }
    }
  });
});

describe('works public entrypoint boundary', () => {
  it('exposes work contracts but not backend workflow switches', () => {
    expect(works.workSchema).toBeDefined();
    expect(works.adminWorkflowPolicySchema).toBeDefined();
    expect(works).not.toHaveProperty('WORKFLOW_AUTO_CHAIN');
    expect(works).not.toHaveProperty('TTS_STEP_ENABLED');
  });
});
