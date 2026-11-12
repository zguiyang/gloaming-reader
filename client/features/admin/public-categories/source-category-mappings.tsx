'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { type Locale, t } from '@/i18n';
import { type PublicCategoryManagementItem, sourceCategoryMappingListSchema } from '@/shared/discovery';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { categoryDisplayName } from '@/features/admin/public-categories/public-categories-model';
import { apiRequest, formatApiError } from '@/lib/api-request';
import { useLocale } from '@/lib/locale-context';

const BASE = '/api/admin/discovery/source-category-mappings';
// Older suggestions persist this system-generated message verbatim. Translate
// only that known message; model-written explanations remain untouched.
const INVALID_PROPOSAL_RATIONALE = 'Invalid or conflicting AI proposal requires review.';
const OMITTED_DETAILS_RATIONALE = 'Category details were omitted to fit the input; creation requires manual review.';

/** Administrator explicitly runs AI and applies source mappings. */
export function SourceCategoryMappings({ categories }: { categories: PublicCategoryManagementItem[] }) {
  const { locale } = useLocale();
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [suggestionLocale, setSuggestionLocale] = useState<Locale>('en-US');
  const [selectedCategories, setSelectedCategories] = useState<Record<string, string>>({});
  const query = useQuery({
    queryKey: ['admin', 'source-category-mappings', page],
    queryFn: ({ signal }) => apiRequest(`${BASE}?page=${page}`, { schema: sourceCategoryMappingListSchema, signal }),
    refetchInterval: (current) =>
      current.state.data?.items.some((item) => item.status === 'analyzing') ? 15000 : false,
  });
  const action = useMutation({
    mutationFn: async ({ id, name, body }: { id: string; name: string; body?: unknown }) => {
      if (name === 'reconcile') {
        // Each request is bounded and checkpointed. A closed tab or failure can
        // safely resume from the last committed batch on the next click.
        for (;;) {
          const result = await apiRequest(`${BASE}/${encodeURIComponent(id)}/reconcile`, {
            method: 'POST',
            schema: z.object({ status: z.enum(['pending', 'completed', 'skipped', 'superseded']) }),
          });
          if (result.status === 'superseded')
            throw new Error(t(locale, 'admin.publicCategories.sourceMappings.changed'));
          if (result.status !== 'pending') return result;
        }
      }
      return apiRequest(`${BASE}/${encodeURIComponent(id)}/${name}`, {
        method: 'POST',
        schema: z.unknown(),
        ...(body === undefined ? {} : { json: body }),
      });
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['admin', 'source-category-mappings'] }),
        client.invalidateQueries({ queryKey: ['admin', 'public-categories'] }),
        client.invalidateQueries({ queryKey: ['discover'] }),
      ]);
      toast.success(t(locale, 'admin.publicCategories.sourceMappings.done'));
    },
    onError: (error) => toast.error(formatApiError(error)),
  });

  return (
    <section className="space-y-3 border-t border-border/60 pt-6">
      <div>
        <h2 className="text-lg font-semibold">{t(locale, 'admin.publicCategories.sourceMappings.title')}</h2>
        <p className="text-sm text-muted-foreground">
          {t(locale, 'admin.publicCategories.sourceMappings.description')}
        </p>
      </div>
      {query.isPending ? (
        <p role="status">{t(locale, 'common.loading')}</p>
      ) : query.isError ? (
        <p role="alert" className="text-destructive">
          {formatApiError(query.error)}
        </p>
      ) : query.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(locale, 'admin.publicCategories.sourceMappings.empty')}</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {query.data.items.map((item) => {
            const suggestion = item.suggestion;
            const proposed =
              suggestion?.categoryIds
                .map((id) => categories.find((category) => category.id === id))
                .filter((category): category is PublicCategoryManagementItem => Boolean(category)) ?? [];
            return (
              <li key={item.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium">{item.sourceValue}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.sourceKey} · {t(locale, `admin.publicCategories.sourceMappings.status.${item.status}`)}
                  </span>
                </div>
                {suggestion ? (
                  <div className="text-sm text-muted-foreground">
                    <p>
                      {suggestion.rationale === INVALID_PROPOSAL_RATIONALE
                        ? t(locale, 'admin.publicCategories.sourceMappings.invalidProposal')
                        : suggestion.rationale === OMITTED_DETAILS_RATIONALE
                          ? t(locale, 'admin.publicCategories.sourceMappings.omittedDetails')
                          : suggestion.rationale}
                    </p>
                    <p>
                      {suggestion.newName ??
                        proposed.map((category) => categoryDisplayName(category, locale)).join(' · ')}
                    </p>
                  </div>
                ) : null}
                {item.status === 'confirmed' && item.categoryIds.length ? (
                  <p className="text-sm text-muted-foreground">
                    {t(locale, 'admin.publicCategories.sourceMappings.mappedTo')}:{' '}
                    {item.categoryIds
                      .map((id) => categories.find((category) => category.id === id))
                      .filter((category): category is PublicCategoryManagementItem => Boolean(category))
                      .map((category) => categoryDisplayName(category, locale))
                      .join(' · ')}
                  </p>
                ) : null}
                {item.lastError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {t(locale, 'admin.publicCategories.errors.operationFailed')}
                  </p>
                ) : null}
                {item.reconciliation === 'pending' ? (
                  <p className="text-sm text-muted-foreground">
                    {t(locale, 'admin.publicCategories.sourceMappings.reconciling')}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {item.canAnalyze ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={action.isPending}
                      onClick={() => action.mutate({ id: item.id, name: 'analyze', body: { enableThinking: true } })}
                    >
                      {t(locale, 'admin.publicCategories.sourceMappings.analyze')}
                    </Button>
                  ) : null}
                  {item.status === 'review' &&
                  suggestion?.outcome === 'reuse' &&
                  proposed.length === suggestion.categoryIds.length ? (
                    <Button
                      size="sm"
                      disabled={action.isPending}
                      onClick={() =>
                        action.mutate({
                          id: item.id,
                          name: 'confirm',
                          body: { revision: item.revision, categoryIds: suggestion.categoryIds },
                        })
                      }
                    >
                      {t(locale, 'admin.publicCategories.sourceMappings.confirm')}
                    </Button>
                  ) : null}
                  {item.status === 'review' && suggestion?.outcome === 'create' ? (
                    <>
                      <Select
                        value={suggestionLocale}
                        onValueChange={(value) => {
                          if (value) setSuggestionLocale(value as Locale);
                        }}
                      >
                        <SelectTrigger aria-label={t(locale, 'admin.publicCategories.sourceMappings.categoryLanguage')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="en-US">English</SelectItem>
                            <SelectItem value="zh-CN">中文</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        disabled={action.isPending}
                        onClick={() =>
                          action.mutate({
                            id: item.id,
                            name: 'create',
                            body: { revision: item.revision, locale: suggestionLocale },
                          })
                        }
                      >
                        {t(locale, 'admin.publicCategories.sourceMappings.create')}
                      </Button>
                    </>
                  ) : null}
                  {item.status !== 'analyzing' && categories.length > 0 ? (
                    <>
                      <Select
                        value={selectedCategories[item.id] || null}
                        onValueChange={(value) =>
                          setSelectedCategories((current) => ({ ...current, [item.id]: value ?? '' }))
                        }
                      >
                        <SelectTrigger
                          aria-label={t(locale, 'admin.publicCategories.sourceMappings.chooseCategory')}
                          className="max-w-48"
                        >
                          <SelectValue
                            placeholder={t(locale, 'admin.publicCategories.sourceMappings.chooseCategory')}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="">
                              {t(locale, 'admin.publicCategories.sourceMappings.chooseCategory')}
                            </SelectItem>
                            {categories.map((category) => (
                              <SelectItem key={category.id} value={category.id}>
                                {categoryDisplayName(category, locale)}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={action.isPending || !selectedCategories[item.id]}
                        onClick={() =>
                          action.mutate({
                            id: item.id,
                            name: 'confirm',
                            body: { revision: item.revision, categoryIds: [selectedCategories[item.id]] },
                          })
                        }
                      >
                        {t(locale, 'admin.publicCategories.sourceMappings.applyCategory')}
                      </Button>
                    </>
                  ) : null}
                  {item.status !== 'ignored' && item.status !== 'analyzing' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={action.isPending}
                      onClick={() => action.mutate({ id: item.id, name: 'ignore', body: { revision: item.revision } })}
                    >
                      {t(locale, 'admin.publicCategories.sourceMappings.ignore')}
                    </Button>
                  ) : null}
                  {item.reconciliation === 'pending' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={action.isPending}
                      onClick={() => action.mutate({ id: item.id, name: 'reconcile' })}
                    >
                      {t(locale, 'admin.publicCategories.sourceMappings.reconcile')}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
          {t(locale, 'admin.publicCategories.sourceMappings.previous')}
        </Button>
        <span className="text-sm">{t(locale, 'admin.publicCategories.sourceMappings.page', { page })}</span>
        <Button
          size="sm"
          variant="outline"
          disabled={!query.data?.hasMore}
          onClick={() => setPage((value) => value + 1)}
        >
          {t(locale, 'admin.publicCategories.sourceMappings.next')}
        </Button>
      </div>
    </section>
  );
}
