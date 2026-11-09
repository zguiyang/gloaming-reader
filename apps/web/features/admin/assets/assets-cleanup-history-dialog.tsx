'use client';

import { XIcon } from 'lucide-react';

import { t } from '@gloaming/i18n';
import type { AssetCleanupJob } from '@gloaming/shared/assets';

import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { AssetsCleanupCard } from '@/features/admin/assets/assets-cleanup-card';
import { useLocale } from '@/lib/locale-context';

type AssetsCleanupHistoryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: AssetCleanupJob;
  retrying?: boolean;
  onRetry?: () => void;
};

export function AssetsCleanupHistoryDialog({
  open,
  onOpenChange,
  job,
  retrying,
  onRetry,
}: AssetsCleanupHistoryDialogProps) {
  const { locale } = useLocale();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(36rem,calc(100dvh-2rem))] max-w-lg gap-0 overflow-hidden p-0 sm:max-w-lg">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border/50 px-5 py-4 sm:px-6">
          <div>
            <DialogTitle className="text-lg font-semibold tracking-tight">
              {t(locale, 'admin.assets.page.cleanupHistory')}
            </DialogTitle>
            <DialogDescription className="sr-only">{t(locale, 'admin.assets.cleanup.title')}</DialogDescription>
          </div>
          <DialogClose
            render={<Button type="button" variant="ghost" size="icon-sm" className="-mr-2 -mt-1 shrink-0" />}
            aria-label={t(locale, 'common.close')}
          >
            <XIcon aria-hidden />
          </DialogClose>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 sm:p-6">
          <AssetsCleanupCard job={job} retrying={retrying} onRetry={onRetry} embedded />
        </div>
      </DialogContent>
    </Dialog>
  );
}
