'use client';

import type { AiInvocationLog } from '@gloaming/shared/ai-invocations';

import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

type AiLogDetailSheetProps = {
  log: AiInvocationLog | null;
  sourceLabel: string;
  purposeLabel: string;
  onOpenChange: (open: boolean) => void;
};

function formatDateTime(iso: string | Date): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return String(iso);
  }
}

function formatCount(value: number | null): string {
  if (value == null) {
    return '-';
  }
  return new Intl.NumberFormat('zh-CN').format(value);
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-all text-foreground">{value}</dd>
    </>
  );
}

export function AiLogDetailSheet({ log, sourceLabel, purposeLabel, onOpenChange }: AiLogDetailSheetProps) {
  const isOpen = log != null;

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg" side="right">
        {log ? (
          <>
            <SheetHeader className="border-b border-border pr-12">
              <div className="flex items-center justify-between gap-3">
                <SheetTitle>调用详情</SheetTitle>
                <Badge variant={log.status === 'success' ? 'secondary' : 'destructive'}>
                  {log.status === 'success' ? '成功' : '失败'}
                </Badge>
              </div>
              <SheetDescription>{formatDateTime(log.createdAt)}</SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-6 px-4 pb-8">
              <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-4 gap-y-3">
                <DetailRow label="调用来源" value={sourceLabel} />
                <DetailRow label="调用类型" value={purposeLabel} />
                <DetailRow label="模型" value={log.modelId ?? '-'} />
                <DetailRow label="延迟" value={log.latencyMs != null ? `${log.latencyMs} ms` : '-'} />
              </dl>

              <Separator />

              <section className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">Token 消耗</h3>
                <div className="rounded-2xl bg-secondary/60 px-4 py-4">
                  <p className="text-sm text-muted-foreground">总消耗</p>
                  <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums text-foreground">
                    {formatCount(log.totalTokens)}
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">输入 Token</p>
                      <p className="mt-1 text-base tabular-nums text-foreground">{formatCount(log.inputTokens)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">输出 Token</p>
                      <p className="mt-1 text-base tabular-nums text-foreground">{formatCount(log.outputTokens)}</p>
                    </div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  费用 ¥ 0<span className="ml-2 text-xs">暂无计价</span>
                </p>
              </section>

              {log.refType || log.refId ? (
                <>
                  <Separator />
                  <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-4 gap-y-3">
                    <DetailRow label="关联类型" value={log.refType ?? '-'} />
                    <DetailRow label="关联 ID" value={log.refId ?? '-'} />
                  </dl>
                </>
              ) : null}

              {log.status === 'failure' ? (
                <>
                  <Separator />
                  <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-4 gap-y-3">
                    <DetailRow label="错误码" value={log.errorCode ?? '-'} />
                    <DetailRow label="错误信息" value={log.errorMessage ?? '-'} />
                  </dl>
                </>
              ) : null}

              {log.requestSummary?.selectionPreview || log.responseSummary?.replyPreview ? (
                <>
                  <Separator />
                  <div className="flex flex-col gap-4">
                    {log.requestSummary?.selectionPreview ? (
                      <div>
                        <p className="text-sm text-muted-foreground">请求摘要</p>
                        <p className="mt-2 text-sm leading-6 text-foreground">{log.requestSummary.selectionPreview}</p>
                      </div>
                    ) : null}
                    {log.responseSummary?.replyPreview ? (
                      <div>
                        <p className="text-sm text-muted-foreground">回复摘要</p>
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
