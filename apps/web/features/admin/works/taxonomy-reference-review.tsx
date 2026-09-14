'use client';

import { t } from '@gloaming/i18n';
import type { TaxonomyOrigin, TaxonomyReference } from '@gloaming/shared/taxonomy';

import { Badge } from '@/components/ui/badge';
import {
  formatTaxonomyLocaleCell,
  formatTaxonomyOrigin,
  formatTranslationStatusLabel,
  getTranslationStatus,
} from '@/features/admin/taxonomy/taxonomy-format';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

function OriginBadge({ origin }: { origin: TaxonomyOrigin }) {
  const { locale } = useLocale();

  return (
    <Badge
      variant="outline"
      className={cn(
        origin === 'ai' && 'border-transparent bg-brand-soft text-brand-deep',
        origin === 'extracted' && 'text-muted-foreground',
      )}
    >
      {formatTaxonomyOrigin(origin, locale)}
    </Badge>
  );
}

function TranslationStatusBadge({ names }: { names: TaxonomyReference['names'] }) {
  const { locale } = useLocale();
  const status = getTranslationStatus(names);

  return (
    <Badge variant={status === 'complete' ? 'secondary' : 'outline'}>
      {formatTranslationStatusLabel(status, locale)}
    </Badge>
  );
}

type TaxonomyReferenceReviewProps = {
  items: readonly TaxonomyReference[];
};

/** Admin review surface — always shows index, zh/en cells, origin, and translation status. */
export function TaxonomyReferenceReview({ items }: TaxonomyReferenceReviewProps) {
  const { locale } = useLocale();

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t(locale, 'admin.content.common.notFilled')}</p>;
  }

  const indexLabel = t(locale, 'admin.taxonomy.panel.tableIndex');
  const zhLabel = t(locale, 'admin.taxonomy.panel.tableChinese');
  const enLabel = t(locale, 'admin.taxonomy.panel.tableEnglish');
  const originLabel = t(locale, 'admin.taxonomy.panel.tableOrigin');
  const translationLabel = t(locale, 'admin.taxonomy.panel.tableTranslationStatus');

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[28rem] text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-container-low text-left text-muted-foreground">
            <th className="px-3 py-2 font-medium">{indexLabel}</th>
            <th className="px-3 py-2 font-medium">{zhLabel}</th>
            <th className="px-3 py-2 font-medium">{enLabel}</th>
            <th className="px-3 py-2 font-medium">{originLabel}</th>
            <th className="px-3 py-2 font-medium">{translationLabel}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => {
            const zhCell = formatTaxonomyLocaleCell(item.names, 'zh-CN', locale);
            const enCell = formatTaxonomyLocaleCell(item.names, 'en-US', locale);
            const isZhMissing = !item.names['zh-CN']?.trim();
            const isEnMissing = !item.names['en-US']?.trim();

            return (
              <tr key={item.id} className="border-b border-border last:border-b-0">
                <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{index + 1}</td>
                <td className={cn('px-3 py-2.5', isZhMissing ? 'text-muted-foreground' : 'font-medium')}>{zhCell}</td>
                <td className={cn('px-3 py-2.5', isEnMissing ? 'text-muted-foreground' : 'font-medium')}>{enCell}</td>
                <td className="px-3 py-2.5">
                  <OriginBadge origin={item.origin} />
                </td>
                <td className="px-3 py-2.5">
                  <TranslationStatusBadge names={item.names} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
