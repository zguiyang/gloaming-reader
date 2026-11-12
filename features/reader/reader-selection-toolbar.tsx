'use client';

import { useMemo } from 'react';

import { t } from '@/i18n';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent } from '@/components/ui/popover';
import type { ReaderSelectionRect } from '@/features/reader/reader-model';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

type ReaderSelectionToolbarProps = {
  visible: boolean;
  rect?: ReaderSelectionRect | null;
  top?: number;
  left?: number;
  onExplain: () => void;
  onAskAi: () => void;
  onLookup: () => void;
  onTranslate: () => void;
  onClose?: (restoreFocus: boolean) => void;
};

export function ReaderSelectionToolbar({
  visible,
  rect,
  top,
  left,
  onExplain,
  onAskAi,
  onLookup,
  onTranslate,
  onClose,
}: ReaderSelectionToolbarProps) {
  const { locale } = useLocale();

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

  if (!visible || !anchor) return null;

  return (
    <Popover
      open={visible}
      onOpenChange={(open, details) => !open && details.reason === 'escape-key' && onClose?.(true)}
    >
      <PopoverContent
        anchor={anchor}
        side="top"
        align="center"
        sideOffset={8}
        collisionPadding={12}
        data-reader-ui
        role="group"
        aria-label={t(locale, 'content.reader.selection.toolbarAria')}
        className={cn(
          'z-50 flex w-auto flex-row items-center gap-0.5 rounded-xl border border-border/60 bg-card p-1 shadow-card outline-hidden',
          'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
          'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
        )}
      >
        <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg px-2.5 text-xs" onClick={onExplain}>
          {t(locale, 'content.reader.selection.explain')}
        </Button>
        <Button type="button" size="sm" className="h-8 rounded-lg px-2.5 text-xs hover:bg-brand-deep" onClick={onAskAi}>
          {t(locale, 'content.reader.selection.askAi')}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg px-2.5 text-xs" onClick={onLookup}>
          {t(locale, 'content.reader.selection.lookup')}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg px-2.5 text-xs" onClick={onTranslate}>
          {t(locale, 'content.reader.selection.translateSelection')}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
