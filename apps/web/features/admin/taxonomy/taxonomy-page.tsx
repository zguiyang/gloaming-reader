'use client';

import { FolderOpen, Link2, PencilLine, Plus, Search, Tags, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import type { TaxonomyItem, TaxonomyKind } from '@gloaming/shared/taxonomy';
import type { WorkMetadataProvenance } from '@gloaming/shared/works';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { AdminSegmentedTabsList, AdminSegmentedTabsTrigger } from '@/features/admin/admin-segmented-tabs';
import {
  formatTaxonomyApiError,
  useCleanupTaxonomy,
  useCreateTaxonomy,
  useDeleteTaxonomy,
  useTaxonomyQuery,
  useUpdateTaxonomy,
} from '@/features/admin/taxonomy/taxonomy-api';
import { cn } from '@/lib/utils';

const KIND_TABS: { value: TaxonomyKind; label: string }[] = [
  { value: 'tag', label: '标签' },
  { value: 'category', label: '分类' },
  { value: 'source', label: '来源' },
];

const ORIGIN_LABEL: Record<WorkMetadataProvenance, string> = {
  extracted: '提取',
  ai: 'AI 生成',
  manual: '人工',
};

/** Dimension origin badge — secondary styling, ember stays reserved for busy states. */
function OriginBadge({ origin }: { origin: WorkMetadataProvenance }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        origin === 'ai' && 'border-transparent bg-brand-soft text-brand-deep',
        origin === 'extracted' && 'text-muted-foreground',
      )}
    >
      {ORIGIN_LABEL[origin]}
    </Badge>
  );
}

type TaxonomySheetProps = {
  kind: TaxonomyKind;
  item: TaxonomyItem | null;
  onClose: () => void;
};

function TaxonomySheet({ kind, item, onClose }: TaxonomySheetProps) {
  const createMutation = useCreateTaxonomy(kind);
  const updateMutation = useUpdateTaxonomy(kind);
  const isEdit = item !== null;
  const [name, setName] = useState(item?.name ?? '');
  const [matchRule, setMatchRule] = useState(item?.matchRule ?? '');
  const [error, setError] = useState<string | null>(null);
  const isPending = createMutation.isPending || updateMutation.isPending;

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('名称必填');
      return;
    }
    setError(null);
    try {
      if (isEdit) {
        await updateMutation.mutateAsync({
          id: item.id,
          body: {
            name: trimmed,
            ...(kind === 'source' ? { matchRule: matchRule.trim() } : {}),
          },
        });
      } else {
        await createMutation.mutateAsync({
          name: trimmed,
          ...(kind === 'source' ? { matchRule: matchRule.trim() } : {}),
        });
      }
      toast.success(isEdit ? '已保存' : '已创建');
      onClose();
    } catch (submitError) {
      setError(formatTaxonomyApiError(submitError));
    }
  }

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="right" className="w-full max-w-md">
        <SheetHeader>
          <SheetTitle>
            {isEdit ? '编辑' : '新建'}
            {kind === 'tag' ? '标签' : kind === 'category' ? '分类' : '来源'}
          </SheetTitle>
          <SheetDescription>
            {kind === 'source' ? '来源为系统保留数据，创建后不可删除。' : '创建后即可在作品编辑与 AI 回填中使用。'}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5">
          <FieldGroup>
            <Field data-invalid={Boolean(error) || undefined}>
              <FieldLabel htmlFor="taxonomy-name">名称</FieldLabel>
              <Input
                id="taxonomy-name"
                value={name}
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
                placeholder={kind === 'source' ? '如 Project Gutenberg' : '如 Fantasy'}
              />
              <FieldError>{error}</FieldError>
            </Field>
          </FieldGroup>

          {kind === 'source' ? (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="taxonomy-match-rule">匹配规则</FieldLabel>
                <Input
                  id="taxonomy-match-rule"
                  value={matchRule}
                  maxLength={200}
                  onChange={(event) => setMatchRule(event.target.value)}
                  placeholder="域名或关键词，如 gutenberg.org"
                />
                <FieldDescription>EPUB 的 dc:source 包含该规则时自动关联此来源；留空表示不自动匹配。</FieldDescription>
              </Field>
            </FieldGroup>
          ) : null}
        </div>

        <SheetFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            取消
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={isPending}>
            {isPending ? '保存中…' : isEdit ? '保存' : '创建'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function TaxonomyTableSkeleton({ columns }: { columns: number }) {
  return (
    <Table aria-hidden>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {Array.from({ length: columns }, (_, index) => (
            <TableHead key={index} className="h-12 bg-surface-container-low px-5 text-muted-foreground">
              <Skeleton className="h-4 w-20 bg-muted/70" />
            </TableHead>
          ))}
          <TableHead className="h-12 w-[1%] bg-surface-container-low px-5 text-right text-muted-foreground">
            操作
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 4 }, (_, rowIndex) => (
          <TableRow key={rowIndex} className="border-border hover:bg-transparent">
            {Array.from({ length: columns }, (_, colIndex) => (
              <TableCell key={colIndex} className="px-5 py-4">
                <Skeleton className="h-4 w-32 max-w-full bg-muted/70" />
              </TableCell>
            ))}
            <TableCell className="px-5 py-4 text-right">
              <Skeleton className="ml-auto h-7 w-16 rounded-xl bg-muted/70" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

type TaxonomyPanelProps = {
  kind: TaxonomyKind;
};

function TaxonomyPanel({ kind }: TaxonomyPanelProps) {
  const [search, setSearch] = useState('');
  const [sheetState, setSheetState] = useState<{ open: boolean; item: TaxonomyItem | null }>({
    open: false,
    item: null,
  });
  const query = useTaxonomyQuery(kind, { search: search || undefined });
  const deleteMutation = useDeleteTaxonomy(kind);
  const cleanupMutation = useCleanupTaxonomy();
  const isSource = kind === 'source';
  const columns = isSource ? 4 : 3;

  async function handleDelete(item: TaxonomyItem) {
    if (!window.confirm(`确定删除「${item.name}」？`)) return;
    try {
      await deleteMutation.mutateAsync(item.id);
      toast.success('已删除');
    } catch (error) {
      toast.error(formatTaxonomyApiError(error));
    }
  }

  async function handleCleanup() {
    if (!window.confirm('将删除所有未被任何作品使用的标签/分类，确定继续？')) return;
    try {
      const result = await cleanupMutation.mutateAsync(kind === 'tag' ? 'tag' : 'category');
      toast.success(result.deleted > 0 ? `已清理 ${result.deleted} 个未使用项` : '没有未使用的项');
    } catch (error) {
      toast.error(formatTaxonomyApiError(error));
    }
  }

  const items = query.data ?? [];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索名称…"
              className="pl-9"
            />
          </div>
          {!isSource ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void handleCleanup()}>
              清理未使用
            </Button>
          ) : null}
        </div>
        <Button
          type="button"
          className="h-10 rounded-xl px-5 hover:bg-brand-deep"
          onClick={() => setSheetState({ open: true, item: null })}
        >
          <Plus data-icon="inline-start" />
          新建{isSource ? '来源' : kind === 'tag' ? '标签' : '分类'}
        </Button>
      </div>

      {query.isPending ? (
        <TaxonomyTableSkeleton columns={columns} />
      ) : items.length === 0 ? (
        <Empty className="border-0 py-16">
          <EmptyMedia variant="icon">{isSource ? <Link2 /> : kind === 'tag' ? <Tags /> : <FolderOpen />}</EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>
              {search ? '没有匹配项' : `暂无${isSource ? '来源' : kind === 'tag' ? '标签' : '分类'}`}
            </EmptyTitle>
            <EmptyDescription>
              {search
                ? '换个关键词试试。'
                : isSource
                  ? '上传作品后来源会自动创建，也可手动新建。'
                  : '可通过「新建」按钮手动添加。'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">名称</TableHead>
                <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">来源</TableHead>
                <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">关联作品</TableHead>
                {isSource ? (
                  <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">匹配规则</TableHead>
                ) : null}
                <TableHead className="h-12 w-[1%] bg-surface-container-low px-5 text-right text-muted-foreground">
                  操作
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const canDelete = !isSource && item.usage === 0;
                return (
                  <TableRow key={item.id} className="border-border">
                    <TableCell className="px-5 py-3.5 font-medium">{item.name}</TableCell>
                    <TableCell className="px-5 py-3.5">
                      <OriginBadge origin={item.origin} />
                    </TableCell>
                    <TableCell className="px-5 py-3.5">
                      {item.usage > 0 ? (
                        <Badge variant="secondary">{item.usage} 部</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">未使用</span>
                      )}
                    </TableCell>
                    {isSource ? (
                      <TableCell className="px-5 py-3.5 text-sm text-muted-foreground">
                        {item.matchRule || '—'}
                      </TableCell>
                    ) : null}
                    <TableCell className="px-5 py-3.5">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setSheetState({ open: true, item })}
                        >
                          <PencilLine data-icon="inline-start" />
                          编辑
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className={cn(
                            !canDelete &&
                              'cursor-not-allowed text-muted-foreground/50 hover:bg-transparent hover:text-muted-foreground/50',
                          )}
                          disabled={!canDelete}
                          title={
                            !canDelete ? (isSource ? '来源为系统保留，不可删除' : '已被作品使用，不可删除') : undefined
                          }
                          onClick={() => void handleDelete(item)}
                        >
                          <Trash2 data-icon="inline-start" />
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {sheetState.open ? (
        <TaxonomySheet kind={kind} item={sheetState.item} onClose={() => setSheetState({ open: false, item: null })} />
      ) : null}
    </div>
  );
}

export function TaxonomyPage() {
  const [kind, setKind] = useState<TaxonomyKind>('tag');

  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 mx-auto w-full max-w-6xl">
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold tracking-tight">维度管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          平台通用的标签 / 分类 / 来源。AI 回填与作品编辑都从这里取数，管理员可增补、改名与清理。
        </p>
      </div>

      <Tabs
        value={kind}
        onValueChange={(value) => {
          if (value === 'tag' || value === 'category' || value === 'source') setKind(value);
        }}
      >
        <AdminSegmentedTabsList className="mb-6" aria-label="维度类型">
          {KIND_TABS.map((tab) => (
            <AdminSegmentedTabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </AdminSegmentedTabsTrigger>
          ))}
        </AdminSegmentedTabsList>
      </Tabs>

      <TaxonomyPanel key={kind} kind={kind} />
    </div>
  );
}
