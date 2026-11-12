'use client';

import { t } from '@gloaming/i18n';

import { RouteLoading } from '@/components/route-loading';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

type GlobalLoadingProps = {
  /** When set, shows a custom loading line. */
  label?: string;
  className?: string;
};

/** Full-viewport overlay — shell session waits and legacy callers. */
export function GlobalLoading({ label, className }: GlobalLoadingProps) {
  const { locale } = useLocale();
  const loadingLabel = label ?? t(locale, 'common.loading');

  return <RouteLoading overlay label={loadingLabel} className={cn(className)} />;
}
