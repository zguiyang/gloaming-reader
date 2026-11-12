'use client';

import { ChevronRightIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { t } from '@/i18n';
import type { ShelfOrganizationProposal, ShelfOrganizationResult } from '@/shared/discovery';

import {
  formatPublicCategoriesApiError,
  useGutenbergShelfTermsQuery,
  useOrganizeUnassignedShelvesMutation,
} from '@/features/admin/public-categories/public-categories-api';
import { useLocale } from '@/lib/locale-context';

function proposalKey(proposal: ShelfOrganizationProposal): string {
  return `${proposal.zhName}:${proposal.enName}:${proposal.shelves.map((shelf) => shelf.mappingId).join(',')}`;
}

/** Header AI utility cue from the Stitch workbench HTML. */
export function ShelfOrganizationPanel() {
  const { locale } = useLocale();
  const shelvesQuery = useGutenbergShelfTermsQuery();
  const organizeMutation = useOrganizeUnassignedShelvesMutation();
  const [result, setResult] = useState<ShelfOrganizationResult | null>(null);

  const unassignedCount = shelvesQuery.data?.items.filter((item) => item.categoryId === null).length ?? 0;
  const canOrganize = unassignedCount > 0 && !organizeMutation.isPending && !shelvesQuery.isPending;

  async function organize() {
    try {
      const next = await organizeMutation.mutateAsync();
      setResult(next);
      if (next.assigned.length === 0 && next.proposals.length === 0 && next.untouchedCount === 0) {
        toast.success(t(locale, 'admin.publicCategories.organize.none'));
      }
    } catch (error) {
      toast.error(formatPublicCategoriesApiError(error));
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-3 sm:items-end">
      <div className="flex shrink-0 items-center gap-2.5 self-start rounded-lg border border-border bg-surface-container-low px-3 py-1.5 text-xs text-muted-foreground sm:self-auto">
        <span className="text-outline">
          {shelvesQuery.isPending
            ? t(locale, 'admin.publicCategories.organize.pendingCountLoading')
            : t(locale, 'admin.publicCategories.organize.pendingCount', { count: unassignedCount })}
        </span>
        <span className="text-border" aria-hidden>
          |
        </span>
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1 font-medium text-primary transition-colors hover:text-brand-deep disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canOrganize}
          onClick={() => void organize()}
        >
          <span>
            {organizeMutation.isPending
              ? t(locale, 'admin.publicCategories.organize.pending')
              : t(locale, 'admin.publicCategories.organize.actionShort')}
          </span>
          <ChevronRightIcon className="size-3" aria-hidden />
        </button>
      </div>

      {result && result.assigned.length > 0 ? (
        <div className="flex w-full flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2 text-xs sm:max-w-md">
          <p>{t(locale, 'admin.publicCategories.organize.assigned', { count: result.assigned.length })}</p>
          <ul className="text-muted-foreground">
            {result.assigned.map((item) => (
              <li key={item.mappingId}>
                {t(locale, 'admin.publicCategories.organize.assignedLine', {
                  shelf: item.displayName,
                  category: item.categoryName,
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result && result.untouchedCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t(locale, 'admin.publicCategories.organize.untouched', { count: result.untouchedCount })}
        </p>
      ) : null}

      {result && result.proposals.length > 0 ? (
        <ul className="flex w-full flex-col gap-2 sm:max-w-md">
          {result.proposals.map((proposal) => (
            <li
              key={proposalKey(proposal)}
              className="flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2 text-xs"
            >
              <p className="font-medium">
                {t(locale, 'admin.publicCategories.organize.proposalTitle')}：{proposal.zhName}
                <span className="ml-2 font-normal text-muted-foreground">{proposal.enName}</span>
              </p>
              {proposal.rationale ? <p className="text-muted-foreground">{proposal.rationale}</p> : null}
              <ul className="text-muted-foreground">
                {proposal.shelves.map((shelf) => (
                  <li key={shelf.mappingId}>{shelf.displayName}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
