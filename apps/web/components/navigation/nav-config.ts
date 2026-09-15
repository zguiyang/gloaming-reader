import { DEFAULT_LOCALE, type Locale, t } from '@gloaming/i18n';

import { AUTH_ROUTES } from '@/constants';

export type NavCopy = {
  wordmark: string;
  discover: string;
  shelf: string;
  shelfShort: string;
  history: string;
  historyShort: string;
  more: string;
  signIn: string;
  account: string;
  signOut: string;
  admin: string;
  themeAppearance: string;
  themeLight: string;
  themeDark: string;
  themeSystem: string;
  siteHeader: string;
  mainNav: string;
  interfaceLanguage: string;
  defaultReaderName: string;
};

/** Localized copy for site / app chrome. */
export function getNavCopy(locale: Locale): NavCopy {
  return {
    wordmark: t(locale, 'nav.wordmark'),
    discover: t(locale, 'nav.discover'),
    shelf: t(locale, 'nav.shelf'),
    shelfShort: t(locale, 'nav.shelfShort'),
    history: t(locale, 'nav.history'),
    historyShort: t(locale, 'nav.historyShort'),
    more: t(locale, 'nav.more'),
    signIn: t(locale, 'nav.signIn'),
    account: t(locale, 'nav.account'),
    signOut: t(locale, 'nav.signOut'),
    admin: t(locale, 'nav.admin'),
    themeAppearance: t(locale, 'nav.themeAppearance'),
    themeLight: t(locale, 'nav.themeLight'),
    themeDark: t(locale, 'nav.themeDark'),
    themeSystem: t(locale, 'nav.themeSystem'),
    siteHeader: t(locale, 'nav.siteHeader'),
    mainNav: t(locale, 'nav.mainNav'),
    interfaceLanguage: t(locale, 'nav.interfaceLanguage'),
    defaultReaderName: t(locale, 'nav.defaultReaderName'),
  };
}

/** Chinese default compatibility export. */
export const NAV_COPY = getNavCopy(DEFAULT_LOCALE);

export type PrimaryNavId = 'shelf' | 'discover' | 'history';

export type PrimaryNavLink = {
  id: PrimaryNavId;
  href: string;
  /** Full label (desktop top nav). */
  label: string;
  /** Compact label (mobile bottom nav). */
  shortLabel: string;
};

/** Desktop top-nav order (unchanged): 发现 → 书架 → 历史. */
export function getPrimaryNavLinks(locale: Locale): readonly PrimaryNavLink[] {
  const copy = getNavCopy(locale);
  return [
    { id: 'discover', href: AUTH_ROUTES.discover, label: copy.discover, shortLabel: copy.discover },
    { id: 'shelf', href: AUTH_ROUTES.shelf, label: copy.shelf, shortLabel: copy.shelfShort },
    { id: 'history', href: AUTH_ROUTES.history, label: copy.history, shortLabel: copy.historyShort },
  ] as const;
}

/** Chinese default compatibility export. */
export const PRIMARY_NAV_LINKS = getPrimaryNavLinks(DEFAULT_LOCALE);

/** Mobile bottom-nav order: 书架 → 发现 → 历史 (+ 更多 handled separately). */
export const MOBILE_PRIMARY_TAB_IDS: readonly PrimaryNavId[] = ['shelf', 'discover', 'history'] as const;

export function getPrimaryNavLink(id: PrimaryNavId, locale: Locale = DEFAULT_LOCALE): PrimaryNavLink {
  const link = getPrimaryNavLinks(locale).find((item) => item.id === id);
  if (!link) {
    throw new Error(`Unknown primary nav id: ${id}`);
  }
  return link;
}

export function matchesNavPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
