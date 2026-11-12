import type { Locale } from './locales.ts';
import enUS from './messages/en-US.json' with { type: 'json' };
import zhCN from './messages/zh-CN.json' with { type: 'json' };

export const messages: Record<Locale, Record<string, unknown>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};
