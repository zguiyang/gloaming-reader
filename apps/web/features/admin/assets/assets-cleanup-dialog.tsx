'use client';

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

type AssetsCleanupDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: AssetScanReport;
  pending?: boolean;
  onConfirm: () => void;
};

export function AssetsCleanupDialog({ open, onOpenChange, report, pending, onConfirm }: AssetsCleanupDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认清理孤儿对象？</AlertDialogTitle>
          <AlertDialogDescription>
            即将删除：
            <br />
            <strong className="text-foreground">
              {report.orphanCount} 个对象 · {formatStorageBytes(report.orphanBytes)}
            </strong>
            <br />
            这些对象当前没有数据库引用，删除后无法恢复。确认后立即创建后台任务，可在本页查看进度。清理前服务端会再次对账，已重新被引用的对象会跳过。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || report.orphanCount === 0}
            variant="destructive"
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {pending ? '提交中…' : '确认清理'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
