'use client';

import { t } from '@gloaming/i18n';
import type { AiInvocationLog } from '@gloaming/shared/ai-invocations';

import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  formatAdminCount,
  formatAdminDateTime,
  formatAdminInvocationStatus,
  formatAdminLatencyMs,
} from '@/features/admin/admin-logs-format';
import { useLocale } from '@/lib/locale-context';

type AiLogDetailSheetProps = {
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

export function AiLogDetailSheet({ log, sourceLabel, purposeLabel, onOpenChange }: AiLogDetailSheetProps) {
  const { locale } = useLocale();
  const isOpen = log != null;
  const emptyValue = t(locale, 'admin.logs.emptyValue');

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg" side="right">
        {log ? (
          <>
            <SheetHeader className="border-b border-border pr-12">
              <div className="flex items-center justify-between gap-3">
                <SheetTitle>{t(locale, 'admin.logs.ai.detailTitle')}</SheetTitle>
                <Badge variant={log.status === 'success' ? 'secondary' : 'destructive'}>
                  {formatAdminInvocationStatus(log.status, locale)}
                </Badge>
              </div>
              <SheetDescription>{formatAdminDateTime(log.createdAt, locale, true)}</SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-6 px-4 pb-8">
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

              {log.requestSummary?.selectionPreview || log.responseSummary?.replyPreview ? (
                <>
                  <Separator />
                  <div className="flex flex-col gap-4">
                    {log.requestSummary?.selectionPreview ? (
                      <div>
                        <p className="text-sm text-muted-foreground">{t(locale, 'admin.logs.ai.requestSummary')}</p>
                        <p className="mt-2 text-sm leading-6 text-foreground">{log.requestSummary.selectionPreview}</p>
                      </div>
                    ) : null}
                    {log.responseSummary?.replyPreview ? (
                      <div>
                        <p className="text-sm text-muted-foreground">{t(locale, 'admin.logs.ai.replySummary')}</p>
                        <p className="mt-2 text-sm leading-6 text-foreground">{log.responseSummary.replyPreview}</p>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
