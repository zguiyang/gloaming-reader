import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('Admin Storage operations surface', () => {
  const featureDirectory = dirname(fileURLToPath(import.meta.url));
  const pageSource = readFileSync(resolve(featureDirectory, 'assets-page.tsx'), 'utf8');
  const apiSource = readFileSync(resolve(featureDirectory, 'assets-api.ts'), 'utf8');

  it('keeps aggregate scan and cleanup while removing the object browser modules', () => {
    expect(existsSync(resolve(featureDirectory, '../../../app/admin/assets/page.tsx'))).toBe(true);
    expect(existsSync(resolve(featureDirectory, 'assets-object-table.tsx'))).toBe(false);
    expect(existsSync(resolve(featureDirectory, 'assets-largest-list.tsx'))).toBe(false);

    expect(pageSource).toMatch(/AssetsSummary/);
    expect(pageSource).toMatch(/AssetsCleanupDialog/);
    expect(pageSource).not.toMatch(/AssetsObjectTable|AssetsLargestList|listScanObjects|viewOrphans/);
  });

  it('loads the latest scan on mount and rescans from a single header CTA', () => {
    expect(apiSource).toMatch(/\/api\/admin\/assets\/scan\/latest/);
    expect(pageSource).toMatch(/useLatestScanQuery/);
    expect(pageSource.match(/admin\.assets\.page\.scanNow/g)).toHaveLength(1);
    expect(pageSource).not.toMatch(/EmptyTitle|emptyTitle/);
  });

  it('keeps in-flight cleanup on a compact banner and terminal history in a dialog', () => {
    expect(pageSource).toMatch(/AssetsCleanupBanner/);
    expect(pageSource).toMatch(/AssetsCleanupHistoryDialog/);
    expect(pageSource).toMatch(/admin\.assets\.page\.cleanupHistory/);
    expect(pageSource).not.toMatch(/\{job \? \(\s*<AssetsCleanupCard/);
  });
});
