'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { type Locale, t } from '@/i18n';
import { PUBLIC_CATEGORY_NAME_MAX_CHARS, type PublicCategoryManagementItem } from '@/shared/discovery';

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
} from '@/features/admin/public-categories/public-categories-model';
import { useLocale } from '@/lib/locale-context';

type Props = {
  category: PublicCategoryManagementItem;
  isEditing: boolean;
  onEditingChange: (next: boolean) => void;
};

function shortLocaleLabel(entryLocale: Locale, uiLocale: Locale): string {
  if (entryLocale === 'zh-CN') return uiLocale.startsWith('zh') ? '中文' : 'Chinese';
  if (entryLocale === 'en-US') return 'English';
  return localeDisplayLabel(entryLocale, uiLocale);
}

/** Stitch multilingual summary + inline editor disclosure. */
export function PublicCategoryLabelsEditor({ category, isEditing, onEditingChange }: Props) {
  const { locale } = useLocale();
  const mutation = useUpdateManagedCategoryLabelMutation();
  const entries = categoryLocaleLabelEntries(category);
  const [drafts, setDrafts] = useState<Partial<Record<Locale, string>>>({});

  const draftValue = (entryLocale: Locale, stored: string | null) => drafts[entryLocale] ?? stored ?? '';

  async function save(target: Locale) {
    const name = draftValue(target, category.localizedNames?.[target] ?? null).trim();
    if (!name) return;
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
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3 text-xs">
      <div className="flex items-center justify-between gap-2 text-muted-foreground">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="font-medium text-foreground">
            {t(locale, 'admin.publicCategories.labels.summaryPrefix')}
          </span>
          {entries
            .filter((entry) => entry.name)
            .map((entry, index) => (
              <span key={entry.locale} className="inline-flex items-center gap-1.5">
                {index > 0 ? <span className="text-border">·</span> : null}
                <span>
                  {shortLocaleLabel(entry.locale, locale)} ({entry.name})
                </span>
              </span>
            ))}
          {entries.every((entry) => !entry.name) ? (
            <span>{t(locale, 'admin.publicCategories.labels.untranslated')}</span>
          ) : null}
        </div>
        <button
          type="button"
          className="shrink-0 cursor-pointer text-outline transition-colors hover:text-primary"
          onClick={() => onEditingChange(!isEditing)}
        >
          {isEditing ? t(locale, 'admin.publicCategories.cancel') : t(locale, 'admin.publicCategories.labels.modify')}
        </button>
      </div>

      {isEditing ? (
        <div className="mt-1 grid grid-cols-1 gap-3 border-t border-border/60 pt-2.5 sm:grid-cols-2">
          {entries.map((entry) => {
            const value = draftValue(entry.locale, entry.name);
            const isDirty = entry.name !== value.trim() && value.trim().length > 0;
            return (
              <div key={entry.locale} className="flex flex-col gap-1">
                <label className="text-[11px] text-outline">{localeDisplayLabel(entry.locale, locale)}</label>
                <div className="flex items-center gap-1.5">
                  <Input
                    value={value}
                    maxLength={PUBLIC_CATEGORY_NAME_MAX_CHARS}
                    placeholder={t(locale, 'admin.publicCategories.create.namePlaceholder')}
                    aria-label={t(locale, 'admin.publicCategories.labels.name', {
                      locale: localeDisplayLabel(entry.locale, locale),
                    })}
                    disabled={mutation.isPending}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setDrafts((current) => ({ ...current, [entry.locale]: next }));
                    }}
                    className="h-7 rounded border-border bg-background px-2.5 text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 px-2 text-xs"
                    disabled={mutation.isPending || !isDirty}
                    onClick={() => void save(entry.locale)}
                  >
                    {t(locale, 'admin.publicCategories.create.confirm')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
