import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { t } from '@/i18n';

const MESSAGE_PATTERN = /message:\s*['"](api\.[^'"]+)['"]/g;

function collectSharedMessageKeys(): string[] {
  const keys = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        for (const match of readFileSync(full, 'utf8').matchAll(MESSAGE_PATTERN)) {
          keys.add(match[1]);
        }
      }
    }
  };
  walk(path.resolve(process.cwd(), 'shared'));
  return [...keys].sort();
}

describe('shared schema messages', () => {
  it('keeps an entry in every locale for each custom api message', () => {
    const keys = collectSharedMessageKeys();
    expect(keys.length).toBeGreaterThan(0);

    const missing = keys.flatMap((key) =>
      (['zh-CN', 'en-US'] as const).filter((locale) => t(locale, key) === key).map((locale) => `${locale}:${key}`),
    );

    expect(missing).toEqual([]);
  });
});
