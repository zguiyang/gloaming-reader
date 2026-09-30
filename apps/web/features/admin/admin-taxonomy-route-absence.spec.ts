import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('removed Admin taxonomy page route', () => {
  it('has no App Router page for /admin/taxonomy', () => {
    const featureDirectory = dirname(fileURLToPath(import.meta.url));

    expect(existsSync(resolve(featureDirectory, '../../app/admin/taxonomy/page.tsx'))).toBe(false);
  });
});
