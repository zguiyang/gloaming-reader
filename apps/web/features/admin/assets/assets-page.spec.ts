import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('Admin Storage operations surface', () => {
  const featureDirectory = dirname(fileURLToPath(import.meta.url));
  const pageSource = readFileSync(resolve(featureDirectory, 'assets-page.tsx'), 'utf8');

  it('keeps aggregate scan and cleanup while removing the object browser modules', () => {
    expect(existsSync(resolve(featureDirectory, '../../../app/admin/assets/page.tsx'))).toBe(true);
    expect(existsSync(resolve(featureDirectory, 'assets-object-table.tsx'))).toBe(false);
    expect(existsSync(resolve(featureDirectory, 'assets-largest-list.tsx'))).toBe(false);

    expect(pageSource).toMatch(/AssetsSummary/);
    expect(pageSource).toMatch(/AssetsCleanupDialog/);
    expect(pageSource).not.toMatch(/AssetsObjectTable|AssetsLargestList|listScanObjects|viewOrphans/);
  });
});
