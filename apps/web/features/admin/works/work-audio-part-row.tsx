'use client';

import { Pause, Play, RotateCcw } from 'lucide-react';
import { useRef, useState } from 'react';

import { type Locale, t } from '@gloaming/i18n';
import type { WorkAudioPartRow } from '@gloaming/shared/content-assets';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { formatAudioTrackStatus } from '@/features/admin/works/works-format';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

function formatDurationMs(ms: number | null): string {
  if (ms == null || ms <= 0) {
    return '0:00';
  }
  const totalSec = Math.round(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatDurationDisplay(track: WorkAudioPartRow['track'], locale: Locale): string {
  if (track.status === 'ready' && track.audioUrl) {
    if (track.durationMs == null || track.durationMs <= 0) {
      return t(locale, 'admin.content.common.notAvailable');
    }
    return formatDurationMs(track.durationMs);
  }
  if (track.status === 'none') {
    return t(locale, 'admin.works.audioTrackStatus.none');
  }
  if (track.status === 'generating') {
    return t(locale, 'admin.works.audioTrackStatus.generating');
  }
  if (track.status === 'failed') {
    return t(locale, 'admin.works.audioTrackStatus.failed');
  }
  if (track.status === 'stale') {
    return t(locale, 'admin.works.audioTrackStatus.stale');
  }
  return t(locale, 'admin.content.common.notAvailable');
}

type WorkAudioPartRowProps = {
  row: WorkAudioPartRow;
  index: number;
  disabled?: boolean;
  onRetry: () => void;
  onExclusivePlay: (audio: HTMLAudioElement) => void;
};

export function WorkAudioPartRowView({ row, index, disabled, onRetry, onExclusivePlay }: WorkAudioPartRowProps) {
  const { locale } = useLocale();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const track = row.track;
  const canPlay = track.status === 'ready' && Boolean(track.audioUrl);
  const isBusy = track.status === 'generating';
  const displayTitle = row.title.trim() || t(locale, 'admin.works.audio.noTitle');

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
      <p className="min-w-0 flex-1 truncate text-sm font-medium" title={displayTitle}>
        {displayTitle}
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
        {isBusy ? <Spinner className="size-3" /> : formatAudioTrackStatus(track.status, locale)}
      </Badge>

      <span
        className={cn(
          'w-12 shrink-0 text-right font-mono text-xs tabular-nums',
          canPlay ? 'text-muted-foreground' : 'text-muted-foreground/50',
        )}
      >
        {formatDurationDisplay(track, locale)}
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
        aria-label={
          isPlaying
            ? t(locale, 'admin.works.audio.pauseAria', { title: displayTitle })
            : t(locale, 'admin.works.audio.playAria', { title: displayTitle })
        }
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
        aria-label={t(locale, 'admin.works.audio.retryAria', { title: displayTitle })}
        onClick={onRetry}
      >
        <RotateCcw className="size-3.5" />
      </Button>
    </div>
  );
}
