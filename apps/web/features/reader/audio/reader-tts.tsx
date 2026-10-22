'use client';

import { ChevronRightIcon, Loader2Icon, PauseIcon, PlayIcon, RotateCwIcon } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import {
  formatPlaybackRate,
  type ReaderAudioRole,
  type ReaderAudioStatus,
  type ReaderPlaybackRate,
} from '@/features/reader/reader-model';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

/** Collapsed footprint: 56px cover + 10px gap + 26px expand trigger. */
const COLLAPSED_WIDTH = 92;
/** Width used only until the intrinsic pill content has been measured. */
const EXPANDED_WIDTH_FALLBACK = 228;
/** Expand folds itself back after this long, unless the pointer or focus is inside. */
const AUTO_COLLAPSE_MS = 4_000;
/** Progress sampling cadence; the 100ms bar transition keeps the fill continuous. */
const PROGRESS_SAMPLE_MS = 100;

type ReaderTtsProps = {
  status: ReaderAudioStatus;
  playbackRate: ReaderPlaybackRate;
  tocOpen: boolean;
  audioRole: ReaderAudioRole;
  /** Work cover used as the rotating avatar; null falls back to the title initial. */
  coverUrl: string | null;
  workTitle: string;
  /** Chapter listening progress, 0–1 — sampled while the pill is expanded. */
  getChapterProgress: () => number;
  onToggle: () => void;
  onCyclePlaybackRate: () => void;
  onSelectRole: (role: ReaderAudioRole) => void;
};

/**
 * Mini player: collapsed it is a rotating cover avatar with the play/pause
 * control overlaid at its centre; the expand arrow only fades in while the
 * avatar cluster is hovered or focused (touch devices keep it visible). Expanded
 * it becomes the compact pill with speed, accent and a chapter progress
 * hairline. Idle entry lives in reader chrome (headphones).
 */
export function ReaderTts({
  status,
  playbackRate,
  tocOpen,
  audioRole,
  coverUrl,
  workTitle,
  getChapterProgress,
  onToggle,
  onCyclePlaybackRate,
  onSelectRole,
}: ReaderTtsProps) {
  const { locale } = useLocale();
  const isActive = status !== 'idle';
  const [isExpanded, setIsExpanded] = useState(false);
  const [isHeldOpen, setIsHeldOpen] = useState(false);
  const [activity, setActivity] = useState(0);
  const [expandedWidth, setExpandedWidth] = useState(EXPANDED_WIDTH_FALLBACK);
  const [failedCoverUrl, setFailedCoverUrl] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const expandButtonRef = useRef<HTMLButtonElement | null>(null);
  const isExpandedPanelRef = useRef<HTMLDivElement | null>(null);
  const expandedContentRef = useRef<HTMLDivElement | null>(null);
  const progressFillRef = useRef<HTMLSpanElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const expandedPanelId = useId();
  /** Auto-collapse only yields to keyboard users; a mouse-clicked button keeps focus forever. */
  const keyboardModalityRef = useRef(false);

  /** Every control interaction restarts the auto-collapse countdown. */
  const bumpActivity = useCallback(() => setActivity((tick) => tick + 1), []);

  const collapse = useCallback(() => {
    const activeElement = document.activeElement;
    const shouldRestoreFocus =
      activeElement instanceof HTMLElement && isExpandedPanelRef.current?.contains(activeElement);
    setIsExpanded(false);
    if (shouldRestoreFocus) {
      // The pill is becoming inert — hand focus back once the collapsed
      // controls are interactive again.
      window.setTimeout(() => expandButtonRef.current?.focus(), 0);
    }
  }, []);

  // Track keyboard modality so focus alone does not pin the pill open for mouse users.
  useEffect(() => {
    const handleKeyDown = () => {
      keyboardModalityRef.current = true;
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  // The pill must fit its content in either locale, so measure the intrinsic
  // row width instead of trusting a hardcoded pixel value that could clip.
  useLayoutEffect(() => {
    const node = expandedContentRef.current;
    if (!node) {
      return;
    }
    const measure = () => {
      const measured = Math.ceil(node.getBoundingClientRect().width);
      if (measured > COLLAPSED_WIDTH) {
        setExpandedWidth((current) => (current === measured ? current : measured));
      }
    };
    const timer = window.setTimeout(measure, 0);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!isExpanded || isHeldOpen) {
      return;
    }
    const timer = window.setTimeout(collapse, AUTO_COLLAPSE_MS);
    return () => window.clearTimeout(timer);
  }, [collapse, isExpanded, isHeldOpen, activity]);

  // Outside press and Escape collapse the pill.
  useEffect(() => {
    if (!isExpanded) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        collapse();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        collapse();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [collapse, isExpanded]);

  // Paint progress straight into the DOM: the audio clock ticks far more often
  // than React should re-render the reader page.
  useEffect(() => {
    if (!isExpanded) {
      return;
    }
    const paint = () => {
      const ratio = Math.min(1, Math.max(0, getChapterProgress()));
      const percent = Math.round(ratio * 1000) / 10;
      if (progressFillRef.current) {
        progressFillRef.current.style.width = `${percent}%`;
      }
      progressBarRef.current?.setAttribute('aria-valuenow', String(Math.round(percent)));
    };
    paint();
    const timer = window.setInterval(paint, PROGRESS_SAMPLE_MS);
    return () => window.clearInterval(timer);
  }, [isExpanded, getChapterProgress]);

  if (!isActive) {
    return null;
  }

  const rateLabel = formatPlaybackRate(playbackRate);
  const isPlaying = status === 'playing';
  const isLoading = status === 'loading';
  const toggleLabel = isPlaying
    ? t(locale, 'content.reader.tts.pause')
    : status === 'error'
      ? t(locale, 'content.reader.tts.retry')
      : t(locale, 'content.reader.tts.play');
  const avatarLabel = isLoading ? t(locale, 'content.reader.tts.loadingAudio') : toggleLabel;
  const coverInitial = Array.from(workTitle.trim())[0]?.toUpperCase() ?? '';

  const handleToggle = () => {
    bumpActivity();
    onToggle();
  };
  const handleRate = () => {
    bumpActivity();
    onCyclePlaybackRate();
  };
  const handleRole = (role: ReaderAudioRole) => {
    bumpActivity();
    onSelectRole(role);
  };
  const handleExpand = () => {
    setIsExpanded(true);
    bumpActivity();
    // The trigger becomes inert while expanded, so hand focus to the revealed
    // controls. Pointer-driven focus does not show a focus-visible ring.
    window.setTimeout(() => {
      isExpandedPanelRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }, 0);
  };

  return (
    <div
      ref={rootRef}
      data-reader-ui
      className={cn(
        'fixed z-40 transition-all duration-300 ease-out-soft',
        'bottom-6 right-6',
        'md:bottom-8 md:right-auto',
        tocOpen ? 'md:left-[350px]' : 'md:left-8',
        tocOpen && 'max-md:pointer-events-none max-md:opacity-0',
      )}
      onPointerDownCapture={() => {
        keyboardModalityRef.current = false;
        setIsHeldOpen(false);
      }}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') {
          setIsHeldOpen(true);
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') {
          setIsHeldOpen(false);
        }
      }}
      onFocusCapture={() => {
        if (keyboardModalityRef.current) {
          setIsHeldOpen(true);
        }
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsHeldOpen(false);
        }
      }}
    >
      <div
        className="relative h-14 transition-[width] duration-[280ms] ease-out-soft motion-reduce:transition-none"
        style={{ width: isExpanded ? expandedWidth : COLLAPSED_WIDTH }}
      >
        {/* Expanded pill surface — stays mounted so width and fade can animate. */}
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 rounded-full border border-border/50 bg-card shadow-card transition-opacity duration-200',
            isExpanded ? 'opacity-100' : 'opacity-0',
          )}
        />

        {/* Collapsed: rotating cover avatar + expand trigger that reveals on hover/focus. */}
        <div
          inert={isExpanded}
          aria-hidden={isExpanded}
          className={cn(
            'group/cluster absolute inset-0 flex flex-row-reverse items-center gap-2.5 transition-opacity duration-150 ease-out-soft md:flex-row',
            isExpanded ? 'pointer-events-none opacity-0' : 'opacity-100',
          )}
        >
          <button
            type="button"
            aria-label={avatarLabel}
            disabled={isLoading}
            onClick={handleToggle}
            className={cn(
              'group relative size-14 shrink-0 overflow-hidden rounded-full shadow-card ring-1 ring-foreground/10',
              'transition-transform duration-200 ease-out-soft motion-safe:active:scale-95',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              'disabled:cursor-wait',
            )}
          >
            <span
              className="absolute inset-0 motion-safe:animate-reader-disc-spin"
              style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}
            >
              {coverUrl && coverUrl !== failedCoverUrl ? (
                // Asset URLs may be same-origin `/api/assets/:id` — plain img avoids next/image remote config.
                // eslint-disable-next-line @next/next/no-img-element -- cover assets served via API proxy
                <img
                  src={coverUrl}
                  alt=""
                  draggable={false}
                  className="size-full object-cover"
                  onError={() => setFailedCoverUrl(coverUrl)}
                />
              ) : (
                <span className="flex size-full items-center justify-center bg-surface-container-high font-heading text-lg text-foreground/70">
                  {coverInitial || '·'}
                </span>
              )}
            </span>
            {isLoading ? (
              <span className="absolute inset-0 grid place-items-center bg-background/60">
                <Loader2Icon className="size-5 animate-spin text-foreground" aria-hidden />
              </span>
            ) : (
              <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
                {/* No scrim: a high-contrast glyph sits directly on the cover; the
                    drop shadow keeps it readable over light artwork. */}
                <span className="text-white opacity-90 drop-shadow-icon transition-[opacity,transform] duration-200 ease-out-soft group-hover:opacity-100 motion-safe:group-hover:scale-105">
                  {isPlaying ? (
                    <PauseIcon className="size-[18px]" fill="currentColor" strokeWidth={1.5} />
                  ) : status === 'error' ? (
                    <RotateCwIcon className="size-[18px]" strokeWidth={2.25} />
                  ) : (
                    <PlayIcon className="size-[18px]" fill="currentColor" strokeWidth={1.5} />
                  )}
                </span>
              </span>
            )}
          </button>

          <button
            ref={expandButtonRef}
            type="button"
            aria-label={t(locale, 'content.reader.tts.expandControls')}
            aria-expanded={isExpanded}
            aria-controls={expandedPanelId}
            onClick={handleExpand}
            className={cn(
              'grid size-[26px] shrink-0 place-items-center rounded-full border border-border/60 bg-surface-container text-muted-foreground',
              'transition-[color,background-color,border-color,opacity,transform] duration-150 ease-out-soft motion-reduce:transition-none',
              'hover:border-brand/60 hover:text-foreground',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              'motion-safe:active:scale-95',
              // Hidden until the cluster is hovered or focused. Touch devices have
              // no hover, so they keep the trigger visible permanently.
              'pointer-events-none scale-90 opacity-0',
              'group-hover/cluster:pointer-events-auto group-hover/cluster:scale-100 group-hover/cluster:opacity-100',
              'group-focus-within/cluster:pointer-events-auto group-focus-within/cluster:scale-100 group-focus-within/cluster:opacity-100',
              '[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:scale-100 [@media(hover:none)]:opacity-100',
            )}
          >
            <ChevronRightIcon className="size-3.5 max-md:-scale-x-100" strokeWidth={2} aria-hidden />
          </button>
        </div>

        {/* Expanded: play/pause, speed, accent and the chapter progress hairline. */}
        <div
          id={expandedPanelId}
          ref={isExpandedPanelRef}
          role="group"
          aria-label={t(locale, 'content.reader.tts.controlsGroup')}
          inert={!isExpanded}
          aria-hidden={!isExpanded}
          className={cn(
            'absolute inset-0 overflow-hidden rounded-full transition-opacity duration-200 ease-out-soft',
            isExpanded ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          <div ref={expandedContentRef} className="absolute inset-y-0 left-0 flex w-max items-center gap-5 pr-3 pl-2">
            <Button
              type="button"
              size="icon"
              className="size-10 shrink-0 rounded-full hover:bg-brand-deep focus-visible:ring-inset"
              aria-label={toggleLabel}
              disabled={isLoading}
              onClick={handleToggle}
            >
              {isLoading ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : isPlaying ? (
                <PauseIcon className="size-4" />
              ) : status === 'error' ? (
                <RotateCwIcon className="size-4" />
              ) : (
                <PlayIcon className="size-4" />
              )}
            </Button>
            <button
              type="button"
              disabled={isLoading}
              aria-label={t(locale, 'content.reader.tts.playbackRate', { rate: rateLabel })}
              onClick={handleRate}
              className={cn(
                'min-w-10 shrink-0 rounded-full px-2 py-1 text-xs font-medium tabular-nums transition-colors duration-200 ease-out-soft',
                'text-muted-foreground hover:text-foreground',
                'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {rateLabel}
            </button>
            <AccentSegment role={audioRole} onSelect={handleRole} />
          </div>

          <div
            ref={progressBarRef}
            role="progressbar"
            aria-label={t(locale, 'content.reader.tts.chapterProgress')}
            aria-valuemin={0}
            aria-valuemax={100}
            className="absolute right-4 bottom-1 left-4 h-[3px] overflow-hidden rounded-full bg-foreground/10"
          >
            <span
              ref={progressFillRef}
              className={cn(
                'block h-full w-0 rounded-full bg-brand',
                isLoading ? 'animate-pulse' : 'transition-[width] duration-100 ease-linear',
              )}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function AccentSegment({ role, onSelect }: { role: ReaderAudioRole; onSelect: (role: ReaderAudioRole) => void }) {
  const { locale } = useLocale();

  return (
    <div
      role="group"
      aria-label={t(locale, 'content.reader.tts.accentGroup')}
      className="flex shrink-0 rounded-full bg-surface-container-high/80 p-0.5"
    >
      <AccentOption
        label={t(locale, 'content.reader.tts.usShort')}
        ariaLabel={t(locale, 'content.reader.tts.usAria')}
        selected={role === 'us'}
        onClick={() => onSelect('us')}
      />
      <AccentOption
        label={t(locale, 'content.reader.tts.ukShort')}
        ariaLabel={t(locale, 'content.reader.tts.ukAria')}
        selected={role === 'uk'}
        onClick={() => onSelect('uk')}
      />
    </div>
  );
}

function AccentOption({
  label,
  ariaLabel,
  selected,
  onClick,
}: {
  label: string;
  ariaLabel: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        'min-w-8 rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-200 ease-out-soft',
        'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none',
        selected ? 'bg-brand-soft text-brand-deep' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}
