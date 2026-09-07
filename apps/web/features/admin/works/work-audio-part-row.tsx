'use client';

import { Pause, Play, RotateCcw } from 'lucide-react';
import { useRef, useState } from 'react';

import type { ContentAssetTrack, WorkAudioPartRow } from '@gloaming/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<ContentAssetTrack['status'], string> = {
  none: '未生成',
  generating: '生成中',
  ready: '已就绪',
  stale: '已过期',
  failed: '失败',
};

function formatDurationMs(ms: number | null): string {
  if (ms == null || ms <= 0) {
    return '—';
  }
  const totalSec = Math.round(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

type WorkAudioPartRowProps = {
  row: WorkAudioPartRow;
  index: number;
  disabled?: boolean;
  onRetry: () => void;
  /** Ensure only one chapter plays at a time. */
  onExclusivePlay: (audio: HTMLAudioElement) => void;
};

export function WorkAudioPartRowView({ row, index, disabled, onRetry, onExclusivePlay }: WorkAudioPartRowProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const track = row.track;
  const canPlay = track.status === 'ready' && Boolean(track.audioUrl);
  const isBusy = track.status === 'generating';

  async function togglePlay() {
    const audio = audioRef.current;
    if (!audio || !canPlay) {
      return;
    }
    if (isPlaying) {
      audio.pause();
      return;
    }
    onExclusivePlay(audio);
    try {
      await audio.play();
    } catch {
      setIsPlaying(false);
    }
  }

  return (
    <div
      className={cn(
        'flex items-center gap-3 py-2.5 transition-colors duration-200 ease-out-soft',
        'border-b border-border last:border-b-0',
        isPlaying && 'bg-brand-soft/40',
      )}
    >
      <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {String(index + 1).padStart(2, '0')}
      </span>
      <p className="min-w-0 flex-1 truncate text-sm font-medium" title={row.title || '（无标题）'}>
        {row.title.trim() || '（无标题）'}
      </p>
      <Badge
        variant="outline"
        className={cn(
          'w-16 shrink-0 justify-center',
          track.status === 'generating' && 'border-transparent bg-brand-soft text-brand-deep',
          track.status === 'failed' && 'border-transparent bg-destructive/10 text-destructive',
          track.status === 'ready' && 'border-transparent bg-secondary text-secondary-foreground',
        )}
      >
        {isBusy ? <Spinner className="size-3" /> : STATUS_LABEL[track.status]}
      </Badge>

      <span
        className={cn(
          'w-12 shrink-0 text-right font-mono text-xs tabular-nums',
          canPlay ? 'text-muted-foreground' : 'text-muted-foreground/50',
        )}
      >
        {canPlay ? formatDurationMs(track.durationMs) : '—'}
      </span>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          'size-8 shrink-0 rounded-full',
          isPlaying && 'bg-primary text-primary-foreground hover:bg-brand-deep hover:text-primary-foreground',
          !isPlaying && canPlay && 'text-brand-deep hover:bg-brand-soft',
        )}
        disabled={!canPlay || disabled}
        aria-label={isPlaying ? `暂停 ${row.title || row.partId}` : `播放 ${row.title || row.partId}`}
        onClick={() => void togglePlay()}
      >
        {isPlaying ? <Pause className="size-3.5 fill-current" /> : <Play className="size-3.5 fill-current" />}
      </Button>

      {canPlay ? (
        <audio
          ref={audioRef}
          preload="none"
          src={track.audioUrl!}
          className="sr-only"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
        />
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
        disabled={disabled || isBusy}
        aria-label={`重试 ${row.title || row.partId}`}
        onClick={onRetry}
      >
        <RotateCcw className="size-3.5" />
      </Button>
    </div>
  );
}
