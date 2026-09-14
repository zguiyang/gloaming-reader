'use client';

import { Loader2Icon, PauseIcon, PlayIcon } from 'lucide-react';

import { t } from '@gloaming/i18n';
import type { ReaderAudioAvailability } from '@gloaming/shared/reader';

import { Button } from '@/components/ui/button';
import {
  formatPlaybackRate,
  type ReaderAudioRole,
  type ReaderAudioStatus,
  type ReaderPlaybackRate,
} from '@/features/reader/reader-model';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

type ReaderTtsProps = {
  status: ReaderAudioStatus;
  playbackRate: ReaderPlaybackRate;
  tocOpen: boolean;
  aiDrawerOpen: boolean;
  audioRole: ReaderAudioRole;
  audioAvailable: ReaderAudioAvailability;
  onToggle: () => void;
  onCyclePlaybackRate: () => void;
  onSelectRole: (role: ReaderAudioRole) => void;
};

/** Mini player only — idle entry lives in reader chrome (headphones). */
export function ReaderTts({
  status,
  playbackRate,
  tocOpen,
  aiDrawerOpen,
  audioRole,
  audioAvailable,
  onToggle,
  onCyclePlaybackRate,
  onSelectRole,
}: ReaderTtsProps) {
  const { locale } = useLocale();
  const isActive = status === 'playing' || status === 'paused' || status === 'loading';
  if (!isActive) return null;

  const hasBothAccents = audioAvailable.us && audioAvailable.uk;
  const rateLabel = formatPlaybackRate(playbackRate);

  return (
    <div
      data-reader-ui
      className={cn(
        'fixed z-40 transition-all duration-300 ease-out-soft',
        'bottom-6 right-6',
        'md:bottom-8 md:right-auto',
        tocOpen ? 'md:left-[350px]' : 'md:left-8',
        aiDrawerOpen && 'max-md:right-6',
        tocOpen && 'max-md:pointer-events-none max-md:opacity-0',
      )}
    >
      <div className="flex items-center gap-2 rounded-full border border-border/50 bg-card py-2 pr-2 pl-3 shadow-card sm:gap-3 sm:pr-3">
        <Button
          type="button"
          size="icon"
          className="size-10 shrink-0 rounded-full hover:bg-brand-deep"
          aria-label={
            status === 'playing' ? t(locale, 'content.reader.tts.pause') : t(locale, 'content.reader.tts.play')
          }
          disabled={status === 'loading'}
          onClick={onToggle}
        >
          {status === 'loading' ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : status === 'playing' ? (
            <PauseIcon className="size-4" />
          ) : (
            <PlayIcon className="size-4" />
          )}
        </Button>
        <button
          type="button"
          disabled={status === 'loading'}
          aria-label={t(locale, 'content.reader.tts.playbackRate', { rate: rateLabel })}
          onClick={onCyclePlaybackRate}
          className={cn(
            'min-w-10 shrink-0 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums transition-colors duration-200 ease-out-soft',
            'text-muted-foreground hover:text-foreground',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {rateLabel}
        </button>
        {hasBothAccents ? (
          <AccentSegment
            role={audioRole}
            available={audioAvailable}
            disabled={status === 'loading'}
            onSelect={onSelectRole}
          />
        ) : null}
      </div>
    </div>
  );
}

function AccentSegment({
  role,
  available,
  disabled,
  onSelect,
}: {
  role: ReaderAudioRole;
  available: ReaderAudioAvailability;
  disabled: boolean;
  onSelect: (role: ReaderAudioRole) => void;
}) {
  const { locale } = useLocale();

  return (
    <div
      role="group"
      aria-label={t(locale, 'content.reader.tts.accentGroup')}
      className="flex shrink-0 rounded-full bg-surface-container-high/80 p-0.5"
    >
      <AccentOption
        role="us"
        label={t(locale, 'content.reader.tts.usShort')}
        ariaLabel={t(locale, 'content.reader.tts.usAria')}
        selected={role === 'us'}
        enabled={available.us}
        disabled={disabled}
        onClick={() => onSelect('us')}
      />
      <AccentOption
        role="uk"
        label={t(locale, 'content.reader.tts.ukShort')}
        ariaLabel={t(locale, 'content.reader.tts.ukAria')}
        selected={role === 'uk'}
        enabled={available.uk}
        disabled={disabled}
        onClick={() => onSelect('uk')}
      />
    </div>
  );
}

function AccentOption({
  label,
  ariaLabel,
  selected,
  enabled,
  disabled,
  onClick,
}: {
  role: ReaderAudioRole;
  label: string;
  ariaLabel: string;
  selected: boolean;
  enabled: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled || !enabled}
      aria-pressed={selected}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        'min-w-8 rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-200 ease-out-soft',
        selected && enabled && 'bg-brand-soft text-brand-deep',
        !selected && enabled && 'text-muted-foreground hover:text-foreground',
        !enabled && 'cursor-not-allowed text-muted-foreground/40',
      )}
    >
      {label}
    </button>
  );
}
