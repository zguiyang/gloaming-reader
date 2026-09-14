import { describe, expect, it } from 'vitest';

import { getNavCopy, getPrimaryNavLinks, NAV_COPY, PRIMARY_NAV_LINKS } from './nav-config';

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
    expect(links.map((item) => item.id)).toEqual(['discover', 'shelf', 'history']);
    expect(links[0]?.label).toBe('Discover');
    expect(links[1]?.shortLabel).toBe('Shelf');
  });

  it('uses Chinese labels for zh-CN', () => {
    const links = getPrimaryNavLinks('zh-CN');
    expect(links[1]?.label).toBe('我的书架');
    expect(links[1]?.shortLabel).toBe('书架');
  });
});

describe('compatibility exports', () => {
  it('keeps NAV_COPY and PRIMARY_NAV_LINKS as Chinese defaults', () => {
    expect(NAV_COPY.discover).toBe('发现');
    expect(PRIMARY_NAV_LINKS[0]?.id).toBe('discover');
    expect(PRIMARY_NAV_LINKS[0]?.label).toBe('发现');
  });
});
