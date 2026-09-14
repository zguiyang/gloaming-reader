'use client';

import { createContext, type ReactNode, useContext, useEffect } from 'react';

import { type Locale, SUPPORTED_LOCALES, t } from '@gloaming/i18n';

import { getClientLocale, setClientLocaleCookie } from './client-locale';

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  localeOptions: readonly { value: Locale; label: string }[];
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

const LOCALE_LABEL_KEYS: Record<Locale, string> = {
  'zh-CN': 'nav.localeZhCN',
  'en-US': 'nav.localeEnUS',
};

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const localeOptions = SUPPORTED_LOCALES.map((value) => ({
    value,
    label: t(locale, LOCALE_LABEL_KEYS[value]),
  }));

  function setLocale(next: Locale) {
    if (next === locale) {
      return;
    }
    setClientLocaleCookie(next);
    window.location.reload();
  }

  return <LocaleContext.Provider value={{ locale, setLocale, localeOptions }}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) {
    throw new Error('useLocale must be used within LocaleProvider');
  }
  return value;
}

/** Client-only locale when context is unavailable (e.g. isolated tests). */
export function useClientLocaleSnapshot(): Locale {
  return getClientLocale();
}
