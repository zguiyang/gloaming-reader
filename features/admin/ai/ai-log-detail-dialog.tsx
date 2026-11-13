'use client';

import { XIcon } from 'lucide-react';

import { t } from '@/i18n';
import type { AiInvocationLog } from '@/shared/ai-invocations';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import {
  formatAdminCount,
  formatAdminDateTime,
  formatAdminInvocationStatus,
  formatAdminLatencyMs,
} from '@/features/admin/admin-logs-format';
import { useLocale } from '@/lib/locale-context';

type AiLogDetailDialogProps = {
  log: AiInvocationLog | null;
  sourceLabel: string;
  purposeLabel: string;
  onOpenChange: (open: boolean) => void;
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-all text-foreground">{value}</dd>
    </>
  );
}

export function AiLogDetailDialog({ log, sourceLabel, purposeLabel, onOpenChange }: AiLogDetailDialogProps) {
  const { locale } = useLocale();
  const isOpen = log != null;
  const emptyValue = t(locale, 'admin.logs.emptyValue');

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(40rem,calc(100dvh-2rem))] max-w-lg gap-0 overflow-hidden p-0 sm:max-w-lg">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border/50 px-5 py-4 sm:px-6">
          <div>
            <div className="flex items-center gap-3">
              <DialogTitle className="text-lg font-semibold tracking-tight">
                {t(locale, 'admin.logs.ai.detailTitle')}
              </DialogTitle>
              {log ? (
                <Badge variant={log.status === 'success' ? 'secondary' : 'destructive'}>
                  {formatAdminInvocationStatus(log.status, locale)}
                </Badge>
              ) : null}
            </div>
            <DialogDescription className="mt-1 text-sm text-muted-foreground">
              {log ? formatAdminDateTime(log.createdAt, locale, true) : ''}
            </DialogDescription>
          </div>
          <DialogClose
            render={<Button type="button" variant="ghost" size="icon-sm" className="-mr-2 -mt-1 shrink-0" />}
            aria-label={t(locale, 'common.close')}
          >
            <XIcon aria-hidden />
          </DialogClose>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-5 sm:px-6">
          {log ? (
            <div className="flex flex-col gap-6">
              <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-4 gap-y-3">
                <DetailRow label={t(locale, 'admin.logs.ai.detailSource')} value={sourceLabel} />
                <DetailRow label={t(locale, 'admin.logs.ai.detailPurpose')} value={purposeLabel} />
                <DetailRow label={t(locale, 'admin.logs.ai.detailModel')} value={log.modelId ?? emptyValue} />
                <DetailRow
                  label={t(locale, 'admin.logs.ai.detailLatency')}
                  value={formatAdminLatencyMs(log.latencyMs, locale)}
                />
              </dl>

              <Separator />

              <section className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">{t(locale, 'admin.logs.ai.tokenSectionTitle')}</h3>
                <div className="rounded-2xl bg-secondary/60 px-4 py-4">
                  <p className="text-sm text-muted-foreground">{t(locale, 'admin.logs.ai.tokenTotal')}</p>
                  <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums text-foreground">
                    {formatAdminCount(log.totalTokens, locale)}
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">{t(locale, 'admin.logs.ai.tokenInput')}</p>
                      <p className="mt-1 text-base tabular-nums text-foreground">
                        {formatAdminCount(log.inputTokens, locale)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{t(locale, 'admin.logs.ai.tokenOutput')}</p>
                      <p className="mt-1 text-base tabular-nums text-foreground">
                        {formatAdminCount(log.outputTokens, locale)}
                      </p>
                    </div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t(locale, 'admin.logs.ai.costLine', { amount: t(locale, 'admin.logs.costPlaceholder') })}
                  <span className="ml-2 text-xs">{t(locale, 'admin.logs.costNotPricedHint')}</span>
                </p>
              </section>

              {log.refType || log.refId ? (
                <>
                  <Separator />
                  <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-4 gap-y-3">
                    <DetailRow label={t(locale, 'admin.logs.ai.refType')} value={log.refType ?? emptyValue} />
                    <DetailRow label={t(locale, 'admin.logs.ai.refId')} value={log.refId ?? emptyValue} />
                  </dl>
                </>
              ) : null}

              {log.status === 'failure' ? (
                <>
                  <Separator />
                  <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-4 gap-y-3">
                    <DetailRow label={t(locale, 'admin.logs.ai.errorCode')} value={log.errorCode ?? emptyValue} />
                    <DetailRow label={t(locale, 'admin.logs.ai.errorMessage')} value={log.errorMessage ?? emptyValue} />
                  </dl>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
