import { describe, expect, it } from 'vitest';

import {
  getNavCopy,
  getPrimaryNavLinks,
  matchesNavPath,
  MOBILE_PRIMARY_TAB_IDS,
  NAV_COPY,
  PRIMARY_NAV_LINKS,
} from './nav-config';

describe('getNavCopy', () => {
  it('returns Chinese chrome copy for zh-CN', () => {
    const copy = getNavCopy('zh-CN');
    expect(copy.discover).toBe('发现');
    expect(copy.interfaceLanguage).toBe('界面语言');
    expect(copy.signOut).toBe('退出登录');
  });

  it('returns English chrome copy for en-US', () => {
    const copy = getNavCopy('en-US');
    expect(copy.discover).toBe('Discover');
    expect(copy.interfaceLanguage).toBe('Interface language');
    expect(copy.signOut).toBe('Sign out');
  });
});

describe('getPrimaryNavLinks', () => {
  it('keeps desktop nav order and localizes labels', () => {
    const links = getPrimaryNavLinks('en-US');
    expect(links.map((item) => item.id)).toEqual(['discover', 'library', 'history']);
    expect(links[0]?.label).toBe('Discover');
    expect(links[1]?.shortLabel).toBe('Library');
    expect(links[1]?.href).toBe('/library');
    expect(MOBILE_PRIMARY_TAB_IDS).toEqual(['library', 'discover', 'history']);
    expect(matchesNavPath('/library', links[1]!.href)).toBe(true);
    expect(matchesNavPath('/library/child', links[1]!.href)).toBe(true);
    expect(matchesNavPath('/my-shelf', links[1]!.href)).toBe(false);
  });

  it('uses Chinese labels for zh-CN', () => {
    const links = getPrimaryNavLinks('zh-CN');
    expect(links[1]?.label).toBe('书库');
    expect(links[1]?.shortLabel).toBe('书库');
  });

  it('has no route file for the retired path', () => {
    expect(existsSync(new URL('../../app/(app)/library/page.tsx', import.meta.url))).toBe(true);
    expect(existsSync(new URL('../../app/(app)/my-shelf/page.tsx', import.meta.url))).toBe(false);
  });
});

describe('compatibility exports', () => {
  it('keeps NAV_COPY and PRIMARY_NAV_LINKS as Chinese defaults', () => {
    expect(NAV_COPY.discover).toBe('发现');
    expect(PRIMARY_NAV_LINKS[0]?.id).toBe('discover');
    expect(PRIMARY_NAV_LINKS[0]?.label).toBe('发现');
  });
});
import { existsSync } from 'node:fs';
