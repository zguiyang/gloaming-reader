import { describe, expect, it } from 'vitest';

import { routes } from '@/routes';

describe('removed Catalog management route registration', () => {
  it('does not register collection or item routes beneath the former CMS path', () => {
    const legacyPrefix = ['/api/admin/catalog', 'works'].join('/');
    const registeredPaths = routes.routes.map((route) => route.path);

    expect(registeredPaths.filter((path) => path === legacyPrefix || path.startsWith(`${legacyPrefix}/`))).toEqual([]);
  });
});
