'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { enqueueAudioResultSchema, type WorkAudioView, workAudioViewSchema } from '@gloaming/shared/content-assets';
import type { TtsVoiceRole } from '@gloaming/shared/tts';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WorkAudioPartRowView } from '@/features/admin/works/work-audio-part-row';
import { formatWorksApiError } from '@/features/admin/works/works-api';
import { apiRequest } from '@/lib/api-request';
import { cn } from '@/lib/utils';

const audioQueryKey = {
  all: ['admin-work-audio'] as const,
  work: (workId: string, role: TtsVoiceRole) => [...audioQueryKey.all, workId, role] as const,
};

async function fetchWorkAudio(workId: string, role: TtsVoiceRole, signal?: AbortSignal): Promise<WorkAudioView> {
  const qs = new URLSearchParams({ role });
  return apiRequest(`/api/admin/works/${encodeURIComponent(workId)}/audio?${qs}`, {
    schema: workAudioViewSchema,
    signal,
  });
}

async function enqueueWorkAudio(
  workId: string,
  body: { roles: TtsVoiceRole[]; force?: boolean },
): Promise<{ enqueued: number; skipped: number }> {
  const result = await apiRequest(`/api/admin/works/${encodeURIComponent(workId)}/audio/generate`, {
    method: 'POST',
    schema: enqueueAudioResultSchema,
    json: body,
  });
  return { enqueued: result.enqueued.length, skipped: result.skipped.length };
}

async function enqueuePartAudio(partId: string, body: { roles: TtsVoiceRole[]; force?: boolean }): Promise<void> {
  await apiRequest(`/api/admin/parts/${encodeURIComponent(partId)}/audio/generate`, {
    method: 'POST',
    schema: enqueueAudioResultSchema,
    json: body,
  });
}

type WorkAudioPanelProps = {
  workId: string;
};

export function WorkAudioPanel({ workId }: WorkAudioPanelProps) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState<TtsVoiceRole>('us');
  const [isForceOpen, setIsForceOpen] = useState(false);
  const playingRef = useRef<HTMLAudioElement | null>(null);

  const query = useQuery({
    queryKey: audioQueryKey.work(workId, role),
    queryFn: ({ signal }) => fetchWorkAudio(workId, role, signal),
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) {
        return false;
      }
      return data.summary.generating > 0 ? 2000 : false;
    },
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: audioQueryKey.work(workId, role) });
  };

  const fillMutation = useMutation({
    mutationFn: () => enqueueWorkAudio(workId, { roles: [role], force: false }),
    onSuccess: (result) => {
      toast.success(`已排队 ${result.enqueued} 章，跳过 ${result.skipped} 章`);
      invalidate();
    },
    onError: (error) => toast.error(formatWorksApiError(error)),
  });

  const forceMutation = useMutation({
    mutationFn: () => enqueueWorkAudio(workId, { roles: [role], force: true }),
    onSuccess: (result) => {
      setIsForceOpen(false);
      toast.success(`已强制重排队 ${result.enqueued} 章`);
      invalidate();
    },
    onError: (error) => toast.error(formatWorksApiError(error)),
  });

  const retryMutation = useMutation({
    mutationFn: (partId: string) => enqueuePartAudio(partId, { roles: [role], force: true }),
    onSuccess: () => {
      toast.success('已排队重试');
      invalidate();
    },
    onError: (error) => toast.error(formatWorksApiError(error)),
  });

  const data = query.data;
  const summary = data?.summary;
  const isMutating = fillMutation.isPending || forceMutation.isPending || retryMutation.isPending;

  function stopExclusivePlayback() {
    playingRef.current?.pause();
    playingRef.current = null;
  }

  function handleExclusivePlay(audio: HTMLAudioElement) {
    if (playingRef.current && playingRef.current !== audio) {
      playingRef.current.pause();
    }
    playingRef.current = audio;
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {summary
            ? `${summary.total} 章 · 就绪 ${summary.ready} · 生成中 ${summary.generating} · 失败 ${summary.failed} · 过期 ${summary.stale} · 未生成 ${summary.none}`
            : '加载章节音频状态…'}
        </p>
        <Tabs
          value={role}
          onValueChange={(value) => {
            if (value === 'us' || value === 'uk') {
              stopExclusivePlayback();
              setRole(value);
            }
          }}
        >
          <TabsList className="h-auto">
            <TabsTrigger value="us" className="px-3 py-1.5">
              美音
            </TabsTrigger>
            <TabsTrigger value="uk" className="px-3 py-1.5">
              英音
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={isMutating} onClick={() => fillMutation.mutate()}>
          {fillMutation.isPending ? <Spinner className="size-3.5" /> : null}
          生成/补齐
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={isMutating} onClick={() => setIsForceOpen(true)}>
          强制全部重生成
        </Button>
      </div>

      {query.isPending ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4 text-brand" />
          加载中…
        </div>
      ) : query.isError ? (
        <p className="text-sm text-destructive">{formatWorksApiError(query.error)}</p>
      ) : (
        <div className={cn('overflow-hidden rounded-xl border border-border bg-card px-3')}>
          {data!.parts.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">暂无章节</p>
          ) : (
            data!.parts.map((row, index) => (
              <WorkAudioPartRowView
                key={row.partId}
                row={row}
                index={index}
                disabled={isMutating}
                onRetry={() => retryMutation.mutate(row.partId)}
                onExclusivePlay={handleExclusivePlay}
              />
            ))
          )}
        </div>
      )}

      <AlertDialog open={isForceOpen} onOpenChange={setIsForceOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>强制全部重生成？</AlertDialogTitle>
            <AlertDialogDescription>
              将覆盖当前「{role === 'us' ? '美音' : '英音'}」下全部 {summary?.total ?? 0}{' '}
              章音频并重新合成，耗时与费用较高。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                forceMutation.mutate();
              }}
            >
              {forceMutation.isPending ? <Spinner className="size-3.5" /> : null}
              确认重生成
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
