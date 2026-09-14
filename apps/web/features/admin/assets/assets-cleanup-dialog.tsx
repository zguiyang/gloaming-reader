'use client';

import { t } from '@gloaming/i18n';
import type { AssetScanReport } from '@gloaming/shared/assets';

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
import { formatStorageBytes } from '@/features/admin/assets/assets-format';
import { useLocale } from '@/lib/locale-context';

type AssetsCleanupDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: AssetScanReport;
  pending?: boolean;
  onConfirm: () => void;
};

export function AssetsCleanupDialog({ open, onOpenChange, report, pending, onConfirm }: AssetsCleanupDialogProps) {
  const { locale } = useLocale();
  const [intro, stats, ...rest] = t(locale, 'admin.assets.cleanup.confirmDescription', {
    count: report.orphanCount,
    bytes: formatStorageBytes(report.orphanBytes),
  }).split('\n');

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(locale, 'admin.assets.cleanup.confirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {intro}
            <br />
            <strong className="text-foreground">{stats}</strong>
            {rest.length > 0 ? (
              <>
                <br />
                {rest.join('\n')}
              </>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t(locale, 'admin.content.common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || report.orphanCount === 0}
            variant="destructive"
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {pending ? t(locale, 'admin.assets.cleanup.submitting') : t(locale, 'admin.assets.cleanup.confirmAction')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
