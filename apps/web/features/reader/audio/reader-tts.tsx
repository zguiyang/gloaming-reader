'use client';

import { Loader2Icon, PauseIcon, PlayIcon, RotateCwIcon } from 'lucide-react';
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

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

/**
 * The card IS the cover circle. Collapsed width equals this diameter;
 * expand only lengthens the trailing edge. Radius stays half the height,
 * so the leading end never stops being that circle.
 */
const CARD_SIZE = 48;
/** Artwork inside the leading circle, leaving a hair of card surface as a matte. */
const AVATAR_INSET = 2;
const AVATAR_SIZE = CARD_SIZE - AVATAR_INSET * 2;
/** Gap from the circle’s trailing edge to the controls. */
const CONTROL_GAP = 8;
/** Where controls begin, measured from the leading edge. */
const CONTROL_START = CARD_SIZE + CONTROL_GAP;
/** Trailing padding after controls. */
const CARD_PAD_END = 14;
const PANEL_BODY_FALLBACK = 168;
const AUTO_COLLAPSE_MS = 4_000;
const LONG_PRESS_MS = 420;
const PROGRESS_SAMPLE_MS = 100;
/** Width of the pill. Opacity of the controls fades a little faster so glyphs aren’t sliced. */
const MORPH_MS = 320;
const CONTROLS_FADE_MS = 180;

type ReaderTtsProps = {
  status: ReaderAudioStatus;
  playbackRate: ReaderPlaybackRate;
  tocOpen: boolean;
  audioRole: ReaderAudioRole;
  coverUrl: string | null;
  workTitle: string;
  getChapterProgress: () => number;
  onToggle: () => void;
  onCyclePlaybackRate: () => void;
  onSelectRole: (role: ReaderAudioRole) => void;
};

/**
 * Collapsed: one circle — the cover is the card.
 * Expanded: that same circle lengthens into a capsule. Cover stays the leading
 * cap; only width changes. Desktop grows right, mobile grows left.
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
  const [panelBodyWidth, setPanelBodyWidth] = useState(PANEL_BODY_FALLBACK);
  const [failedCoverUrl, setFailedCoverUrl] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelBodyRef = useRef<HTMLDivElement | null>(null);
  const progressFillRef = useRef<HTMLSpanElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const keyboardModalityRef = useRef(false);
  const expandedPanelId = useId();

  const bumpActivity = useCallback(() => setActivity((tick) => tick + 1), []);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const collapse = useCallback(() => {
    setIsExpanded(false);
  }, []);

  const expand = useCallback(() => {
    setIsExpanded(true);
    bumpActivity();
  }, [bumpActivity]);

  useEffect(() => {
    const handleKeyDown = () => {
      keyboardModalityRef.current = true;
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  useLayoutEffect(() => {
    const node = panelBodyRef.current;
    if (!node) {
      return;
    }
    const measure = () => {
      const measured = Math.ceil(node.scrollWidth);
      if (measured > 0) {
        setPanelBodyWidth((current) => (current === measured ? current : measured));
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

  useEffect(() => () => clearLongPress(), [clearLongPress]);

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

  const cardWidth = CONTROL_START + panelBodyWidth + CARD_PAD_END;
  const clusterWidth = isExpanded ? cardWidth : CARD_SIZE;

  const handleToggle = () => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
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

  const handleAvatarPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    keyboardModalityRef.current = false;
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') {
      return;
    }
    clearLongPress();
    longPressTriggeredRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      expand();
    }, LONG_PRESS_MS);
  };

  const clearLongPressGesture = () => {
    clearLongPress();
  };

  const cancelLongPressGesture = () => {
    clearLongPress();
    longPressTriggeredRef.current = false;
  };

  return (
    <div
      ref={rootRef}
      data-reader-ui
      className={cn(
        'fixed z-40 transition-[left,right,bottom,opacity] duration-300 ease-out-soft',
        'bottom-6 right-6',
        'md:bottom-8 md:right-auto',
        tocOpen ? 'md:left-[350px]' : 'md:left-8',
        tocOpen && 'max-md:pointer-events-none max-md:opacity-0',
      )}
      onMouseEnter={() => {
        setIsHeldOpen(true);
        expand();
      }}
      onMouseLeave={() => {
        setIsHeldOpen(false);
      }}
      onFocusCapture={() => {
        if (keyboardModalityRef.current) {
          setIsHeldOpen(true);
          expand();
        }
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsHeldOpen(false);
        }
      }}
    >
      <div
        className="relative transition-[width] ease-out-soft motion-reduce:transition-none"
        style={
          {
            width: clusterWidth,
            height: CARD_SIZE,
            transitionDuration: `${MORPH_MS}ms`,
          } as CSSProperties
        }
      >
        {/*
          Pill — collapsed width is the circle itself. Width is the only tween;
          radius stays a semicircle so the leading cap never changes shape.
        */}
        <div
          className={cn(
            'absolute top-0 overflow-hidden rounded-full bg-card shadow-card ring-1 ring-border/50',
            'transition-[width] ease-out-soft motion-reduce:transition-none',
            'right-0 md:right-auto md:left-0',
          )}
          style={
            {
              height: CARD_SIZE,
              width: clusterWidth,
              transitionDuration: `${MORPH_MS}ms`,
            } as CSSProperties
          }
        >
          <div
            id={expandedPanelId}
            role="group"
            aria-label={t(locale, 'content.reader.tts.controlsGroup')}
            aria-hidden={!isExpanded}
            inert={!isExpanded}
            className={cn(
              'absolute inset-y-0 flex flex-col justify-center',
              'transition-opacity ease-out motion-reduce:transition-none',
              // Mobile grows left: cover slot is the trailing pad. Desktop grows right.
              'right-0 pl-[var(--tts-end)] pr-[var(--tts-lead)]',
              'md:right-auto md:left-0 md:pl-[var(--tts-lead)] md:pr-[var(--tts-end)]',
            )}
            style={
              {
                width: cardWidth,
                opacity: isExpanded ? 1 : 0,
                transitionDuration: `${CONTROLS_FADE_MS}ms`,
                ['--tts-lead' as string]: `${CONTROL_START}px`,
                ['--tts-end' as string]: `${CARD_PAD_END}px`,
              } as CSSProperties
            }
          >
            <div ref={panelBodyRef} className="flex w-max items-center gap-2.5">
              <Button
                variant="plain"
                size={null}
                type="button"
                disabled={isLoading}
                aria-label={t(locale, 'content.reader.tts.playbackRate', { rate: rateLabel })}
                onClick={handleRate}
                className={cn(
                  'min-w-9 shrink-0 rounded-md px-1.5 py-1 text-xs font-medium tabular-nums transition-colors duration-200 ease-out-soft',
                  'text-muted-foreground hover:text-foreground',
                  'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                {rateLabel}
              </Button>
              <AccentSegment role={audioRole} onSelect={handleRole} />
            </div>

            <div
              ref={progressBarRef}
              role="progressbar"
              aria-label={t(locale, 'content.reader.tts.chapterProgress')}
              aria-valuemin={0}
              aria-valuemax={100}
              className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-foreground/10"
              style={{ width: panelBodyWidth }}
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

        {/* Leading cap. Same box in both states — the pill grows out from this edge. */}
        <div
          data-tts-avatar
          className="absolute top-0 z-10 max-md:right-0 md:left-0"
          style={{ width: CARD_SIZE, height: CARD_SIZE }}
        >
          <Button
            variant="plain"
            size={null}
            type="button"
            aria-label={avatarLabel}
            aria-expanded={isExpanded}
            aria-controls={expandedPanelId}
            disabled={isLoading}
            onClick={handleToggle}
            onPointerDown={handleAvatarPointerDown}
            onPointerUp={clearLongPressGesture}
            onPointerCancel={cancelLongPressGesture}
            onPointerLeave={cancelLongPressGesture}
            className={cn(
              'relative size-full rounded-full',
              'transition-transform duration-200 ease-out-soft motion-safe:active:scale-95',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              'disabled:cursor-wait',
            )}
          >
            <span
              className="absolute overflow-hidden rounded-full bg-surface-container-high ring-1 ring-foreground/10 motion-safe:animate-reader-disc-spin"
              style={{
                inset: AVATAR_INSET,
                animationPlayState: isPlaying ? 'running' : 'paused',
              }}
            >
              {coverUrl && coverUrl !== failedCoverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- cover assets served via API proxy
                <img
                  src={coverUrl}
                  alt=""
                  draggable={false}
                  className="size-full object-cover"
                  onError={() => setFailedCoverUrl(coverUrl)}
                />
              ) : (
                <span className="flex size-full items-center justify-center font-heading text-base text-foreground/70">
                  {coverInitial || '·'}
                </span>
              )}
            </span>
            {isLoading ? (
              <span
                className="absolute grid place-items-center overflow-hidden rounded-full bg-background/60"
                style={{ inset: AVATAR_INSET }}
              >
                <Loader2Icon className="size-5 animate-spin text-foreground" aria-hidden />
              </span>
            ) : (
              <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
                <span className="text-white opacity-90 drop-shadow-icon">
                  {isPlaying ? (
                    <PauseIcon className="size-4" fill="currentColor" strokeWidth={1.5} />
                  ) : status === 'error' ? (
                    <RotateCwIcon className="size-4" strokeWidth={2.25} />
                  ) : (
                    <PlayIcon className="size-4" fill="currentColor" strokeWidth={1.5} />
                  )}
                </span>
              </span>
            )}
          </Button>
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
      className="flex shrink-0 rounded-lg bg-surface-container-high/80 p-0.5"
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
    <Button
      variant="plain"
      size={null}
      type="button"
      aria-pressed={selected}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        'min-w-8 rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-200 ease-out-soft',
        'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none',
        selected ? 'bg-brand-soft text-brand-deep' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </Button>
  );
}
