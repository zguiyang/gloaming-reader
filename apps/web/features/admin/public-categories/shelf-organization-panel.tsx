'use client';

import { SparklesIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';
import type { ShelfOrganizationProposal, ShelfOrganizationResult } from '@gloaming/shared/discovery';

import { Button } from '@/components/ui/button';
import {
  formatPublicCategoriesApiError,
  useOrganizeUnassignedShelvesMutation,
} from '@/features/admin/public-categories/public-categories-api';
import { useLocale } from '@/lib/locale-context';

function proposalKey(proposal: ShelfOrganizationProposal): string {
  return `${proposal.zhName}:${proposal.enName}:${proposal.shelves.map((shelf) => shelf.mappingId).join(',')}`;
}

export function ShelfOrganizationPanel() {
  const { locale } = useLocale();
  const organizeMutation = useOrganizeUnassignedShelvesMutation();
  const [result, setResult] = useState<ShelfOrganizationResult | null>(null);

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
    <section className="flex flex-col gap-3 rounded-2xl border border-border/60 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" disabled={organizeMutation.isPending} onClick={() => void organize()}>
          <SparklesIcon data-icon="inline-start" aria-hidden />
          {organizeMutation.isPending
            ? t(locale, 'admin.publicCategories.organize.pending')
            : t(locale, 'admin.publicCategories.organize.action')}
        </Button>
      </div>

      {result && result.assigned.length > 0 ? (
        <div className="flex flex-col gap-1 text-sm">
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
        <p className="text-sm text-muted-foreground">
          {t(locale, 'admin.publicCategories.organize.untouched', { count: result.untouchedCount })}
        </p>
      ) : null}

      {result && result.proposals.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {result.proposals.map((proposal) => {
            const key = proposalKey(proposal);
            return (
              <li key={key} className="flex flex-col gap-2 rounded-xl border border-border/60 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-sm font-medium">
                    {t(locale, 'admin.publicCategories.organize.proposalTitle')}：{proposal.zhName}
                    <span className="ml-2 font-normal text-muted-foreground">{proposal.enName}</span>
                  </h2>
                </div>
                {proposal.rationale ? <p className="text-sm text-muted-foreground">{proposal.rationale}</p> : null}
                <p className="text-xs text-muted-foreground">
                  {t(locale, 'admin.publicCategories.organize.proposalShelves')}
                </p>
                <ul className="text-sm">
                  {proposal.shelves.map((shelf) => (
                    <li key={shelf.mappingId}>{shelf.displayName}</li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
