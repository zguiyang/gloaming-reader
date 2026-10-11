'use client';

import { CheckIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { type Locale, t } from '@gloaming/i18n';
import { PUBLIC_CATEGORY_NAME_MAX_CHARS, type PublicCategoryManagementItem } from '@gloaming/shared/discovery';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  formatPublicCategoriesApiError,
  isCategoryNameCollisionError,
  useUpdateManagedCategoryLabelMutation,
} from '@/features/admin/public-categories/public-categories-api';
import {
  categoryLocaleLabelEntries,
  localeDisplayLabel,
  missingCategoryLocales,
} from '@/features/admin/public-categories/public-categories-model';
import { useLocale } from '@/lib/locale-context';

/**
 * One compact row per supported locale. A save patches exactly that locale's
 * label, so a uniqueness collision in one language never discards edits in
 * another and the stable category id is never touched.
 */
export function PublicCategoryLabelsEditor({ category }: { category: PublicCategoryManagementItem }) {
  const { locale } = useLocale();
  const mutation = useUpdateManagedCategoryLabelMutation();
  const entries = categoryLocaleLabelEntries(category);
  const [drafts, setDrafts] = useState<Partial<Record<Locale, string>>>({});
  const missing = missingCategoryLocales(category);

  const draftValue = (entryLocale: Locale, stored: string | null) => drafts[entryLocale] ?? stored ?? '';

  async function save(target: Locale) {
    const name = draftValue(target, category.localizedNames?.[target] ?? null).trim();
    if (!name) {
      return;
    }
    try {
      await mutation.mutateAsync({ categoryId: category.id, name, locale: target });
      setDrafts((current) => ({ ...current, [target]: undefined }));
      toast.success(t(locale, 'admin.publicCategories.labels.saved'));
    } catch (error) {
      toast.error(
        isCategoryNameCollisionError(error)
          ? t(locale, 'admin.publicCategories.labels.nameExists')
          : formatPublicCategoriesApiError(error),
      );
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-medium">{t(locale, 'admin.publicCategories.labels.title')}</h2>
        <p className="text-xs text-muted-foreground">
          {missing.length === 0
            ? t(locale, 'admin.publicCategories.labels.complete')
            : t(locale, 'admin.publicCategories.labels.missing', {
                locale: missing.map((tag) => localeDisplayLabel(tag, locale)).join(' / '),
              })}
        </p>
      </div>

      <ul className="mt-3 flex flex-col gap-2">
        {entries.map((entry) => {
          const value = draftValue(entry.locale, entry.name);
          const isDirty = entry.name !== value.trim() && value.trim().length > 0;
          return (
            <li key={entry.locale} className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs text-muted-foreground">
                {localeDisplayLabel(entry.locale, locale)}
              </span>
              <Input
                value={value}
                maxLength={PUBLIC_CATEGORY_NAME_MAX_CHARS}
                placeholder={t(locale, 'admin.publicCategories.create.namePlaceholder')}
                aria-label={`${t(locale, 'admin.publicCategories.labels.save', {
                  locale: localeDisplayLabel(entry.locale, locale),
                })}`}
                disabled={mutation.isPending}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  setDrafts((current) => ({ ...current, [entry.locale]: next }));
                }}
                className="h-8"
              />
              {entry.isManual ? (
                <Badge variant="outline">{t(locale, 'admin.publicCategories.provenance.manual')}</Badge>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                aria-label={t(locale, 'admin.publicCategories.labels.save', {
                  locale: localeDisplayLabel(entry.locale, locale),
                })}
                disabled={mutation.isPending || !isDirty}
                onClick={() => void save(entry.locale)}
              >
                <CheckIcon aria-hidden />
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
