'use client';

import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { useMemo, useState } from 'react';

import { t } from '@gloaming/i18n';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ReaderMarkdown } from '@/features/reader/assist/reader-markdown';
import type { ReaderSelectionRect } from '@/features/reader/reader-model';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

type ReaderAiInlineProps = {
  open: boolean;
  quote: string;
  answer: string;
  streaming: boolean;
  mode?: 'answer' | 'question';
  canOpenDrawer?: boolean;
  error?: string | null;
  rect?: ReaderSelectionRect | null;
  top?: number;
  left?: number;
  onSubmitQuestion?: (question: string) => void;
  onOpenDrawer: () => void;
  onClose: () => void;
};

export function ReaderAiInline({
  open,
  quote,
  answer,
  streaming,
  mode = 'answer',
  canOpenDrawer = true,
  error,
  rect,
  top,
  left,
  onSubmitQuestion,
  onOpenDrawer,
  onClose,
}: ReaderAiInlineProps) {
  const { locale } = useLocale();
  const [draft, setDraft] = useState('');

  const anchor = useMemo(() => {
    if (rect) {
      return {
        getBoundingClientRect: () =>
          ({
            top: rect.top,
            left: rect.left,
            bottom: rect.bottom,
            right: rect.right,
            width: rect.width,
            height: rect.height,
            x: rect.left,
            y: rect.top,
            toJSON: () => rect,
          }) as DOMRect,
      };
    }
    if (top !== undefined && left !== undefined && (top !== 0 || left !== 0)) {
      return {
        getBoundingClientRect: () =>
          ({
            top,
            left,
            bottom: top,
            right: left,
            width: 0,
            height: 0,
            x: left,
            y: top,
            toJSON: () => ({ top, left, bottom: top, right: left, width: 0, height: 0 }),
          }) as DOMRect,
      };
    }
    return null;
  }, [rect, top, left]);

  if (!open || !anchor) return null;

  function submitQuestion() {
    const question = draft.trim();
    if (!question || streaming) return;
    onSubmitQuestion?.(question);
    setDraft('');
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          anchor={anchor}
          side="bottom"
          align="center"
          sideOffset={8}
          collisionPadding={16}
          className="isolate z-50"
        >
          <PopoverPrimitive.Popup
            data-reader-ui
            role="dialog"
            aria-label={
              mode === 'question'
                ? t(locale, 'content.reader.assist.inlineQuestionAria')
                : t(locale, 'content.reader.assist.inlineAria')
            }
            className={cn(
              'z-50 w-[min(24rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] rounded-2xl border border-border/50 bg-card p-4 shadow-card outline-hidden',
              'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
              'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            )}
          >
            <p className="line-clamp-2 border-l-2 border-primary/40 pl-3 font-heading text-sm italic text-muted-foreground">
              “{quote}”
            </p>
            {mode === 'question' ? (
              <form
                className="mt-3 space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitQuestion();
                }}
              >
                <Input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={t(locale, 'content.reader.assist.questionPlaceholder')}
                  className="h-10 rounded-xl border-border/60 bg-background"
                  disabled={streaming}
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={onClose}>
                    {t(locale, 'content.reader.assist.cancel')}
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    className="h-8 rounded-lg text-xs hover:bg-brand-deep"
                    disabled={streaming}
                  >
                    {t(locale, 'content.reader.assist.send')}
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <div className="mt-3 min-h-5">
                  <ReaderMarkdown content={answer} streaming={streaming} />
                </div>
                {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
                <div className="mt-4 flex items-center justify-between gap-2">
                  <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={onClose}>
                    {t(locale, 'content.reader.assist.close')}
                  </Button>
                  {canOpenDrawer ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 rounded-lg text-xs hover:bg-brand-deep"
                      onClick={onOpenDrawer}
                      disabled={streaming}
                    >
                      {t(locale, 'content.reader.assist.continueInDrawer')}
                    </Button>
                  ) : (
                    <p className="max-w-[12rem] text-right text-[11px] leading-snug text-muted-foreground">
                      {t(locale, 'content.reader.assist.continueUnavailable')}
                    </p>
                  )}
                </div>
              </>
            )}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
