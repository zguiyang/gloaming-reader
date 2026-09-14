'use client';

import { FolderOpen, Link2, PencilLine, Plus, Search, Tags, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';
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
import { formatProvenance } from '@/features/admin/works/works-format';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

const KIND_KEYS: Record<TaxonomyKind, string> = {
  tag: 'tag',
  category: 'category',
  source: 'source',
};

/** Dimension origin badge — secondary styling, ember stays reserved for busy states. */
function OriginBadge({ origin }: { origin: WorkMetadataProvenance }) {
  const { locale } = useLocale();

  return (
    <Badge
      variant="outline"
      className={cn(
        origin === 'ai' && 'border-transparent bg-brand-soft text-brand-deep',
        origin === 'extracted' && 'text-muted-foreground',
      )}
    >
      {formatProvenance(origin, locale)}
    </Badge>
  );
}

function taxonomyKindLabel(kind: TaxonomyKind, locale: ReturnType<typeof useLocale>['locale']): string {
  return t(locale, `admin.taxonomy.kind.${KIND_KEYS[kind]}`);
}

function createButtonLabel(kind: TaxonomyKind, locale: ReturnType<typeof useLocale>['locale']): string {
  if (kind === 'source') return t(locale, 'admin.taxonomy.panel.createSource');
  if (kind === 'tag') return t(locale, 'admin.taxonomy.panel.createTag');
  return t(locale, 'admin.taxonomy.panel.createCategory');
}

type TaxonomySheetProps = {
  kind: TaxonomyKind;
  item: TaxonomyItem | null;
  onClose: () => void;
};

function TaxonomySheet({ kind, item, onClose }: TaxonomySheetProps) {
  const { locale } = useLocale();
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
      setError(t(locale, 'admin.content.common.nameRequired'));
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
      toast.success(isEdit ? t(locale, 'admin.content.common.saved') : t(locale, 'admin.content.common.created'));
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
            {isEdit ? t(locale, 'admin.taxonomy.sheet.edit') : t(locale, 'admin.taxonomy.sheet.create')}
            {taxonomyKindLabel(kind, locale)}
          </SheetTitle>
          <SheetDescription>
            {kind === 'source'
              ? t(locale, 'admin.taxonomy.sheet.sourceDescription')
              : t(locale, 'admin.taxonomy.sheet.otherDescription')}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5">
          <FieldGroup>
            <Field data-invalid={Boolean(error) || undefined}>
              <FieldLabel htmlFor="taxonomy-name">{t(locale, 'admin.taxonomy.sheet.nameLabel')}</FieldLabel>
              <Input
                id="taxonomy-name"
                value={name}
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
                placeholder={
                  kind === 'source'
                    ? t(locale, 'admin.taxonomy.sheet.sourceNamePlaceholder')
                    : t(locale, 'admin.taxonomy.sheet.genericNamePlaceholder')
                }
              />
              <FieldError>{error}</FieldError>
            </Field>
          </FieldGroup>

          {kind === 'source' ? (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="taxonomy-match-rule">
                  {t(locale, 'admin.taxonomy.sheet.matchRuleLabel')}
                </FieldLabel>
                <Input
                  id="taxonomy-match-rule"
                  value={matchRule}
                  maxLength={200}
                  onChange={(event) => setMatchRule(event.target.value)}
                  placeholder={t(locale, 'admin.taxonomy.sheet.matchRulePlaceholder')}
                />
                <FieldDescription>{t(locale, 'admin.taxonomy.sheet.matchRuleHint')}</FieldDescription>
              </Field>
            </FieldGroup>
          ) : null}
        </div>

        <SheetFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            {t(locale, 'admin.content.common.cancel')}
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={isPending}>
            {isPending
              ? t(locale, 'admin.content.common.saving')
              : isEdit
                ? t(locale, 'admin.content.common.save')
                : t(locale, 'admin.taxonomy.sheet.create')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function TaxonomyTableSkeleton({ columns }: { columns: number }) {
  const { locale } = useLocale();

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
            {t(locale, 'admin.content.common.actions')}
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
  const { locale } = useLocale();
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
  const kindLabel = taxonomyKindLabel(kind, locale);

  async function handleDelete(item: TaxonomyItem) {
    if (!window.confirm(t(locale, 'admin.taxonomy.panel.confirmDelete', { name: item.name }))) return;
    try {
      await deleteMutation.mutateAsync(item.id);
      toast.success(t(locale, 'admin.content.common.deleted'));
    } catch (error) {
      toast.error(formatTaxonomyApiError(error));
    }
  }

  async function handleCleanup() {
    if (!window.confirm(t(locale, 'admin.taxonomy.panel.confirmCleanup'))) return;
    try {
      const result = await cleanupMutation.mutateAsync(kind === 'tag' ? 'tag' : 'category');
      toast.success(
        result.deleted > 0
          ? t(locale, 'admin.taxonomy.panel.cleanupResult', { count: result.deleted })
          : t(locale, 'admin.taxonomy.panel.cleanupNone'),
      );
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
              placeholder={t(locale, 'admin.taxonomy.panel.searchPlaceholder')}
              className="pl-9"
            />
          </div>
          {!isSource ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void handleCleanup()}>
              {t(locale, 'admin.taxonomy.panel.cleanupUnused')}
            </Button>
          ) : null}
        </div>
        <Button
          type="button"
          className="h-10 rounded-xl px-5 hover:bg-brand-deep"
          onClick={() => setSheetState({ open: true, item: null })}
        >
          <Plus data-icon="inline-start" />
          {createButtonLabel(kind, locale)}
        </Button>
      </div>

      {query.isPending ? (
        <TaxonomyTableSkeleton columns={columns} />
      ) : items.length === 0 ? (
        <Empty className="border-0 py-16">
          <EmptyMedia variant="icon">{isSource ? <Link2 /> : kind === 'tag' ? <Tags /> : <FolderOpen />}</EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>
              {search
                ? t(locale, 'admin.taxonomy.panel.emptyNoMatchSearch')
                : t(locale, 'admin.taxonomy.panel.emptyNoMatch', { kind: kindLabel })}
            </EmptyTitle>
            <EmptyDescription>
              {search
                ? t(locale, 'admin.taxonomy.panel.emptySearchHint')
                : isSource
                  ? t(locale, 'admin.taxonomy.panel.emptySourceHint')
                  : t(locale, 'admin.taxonomy.panel.emptyManualHint')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
                  {t(locale, 'admin.taxonomy.panel.tableName')}
                </TableHead>
                <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
                  {t(locale, 'admin.taxonomy.panel.tableOrigin')}
                </TableHead>
                <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
                  {t(locale, 'admin.taxonomy.panel.tableUsage')}
                </TableHead>
                {isSource ? (
                  <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
                    {t(locale, 'admin.taxonomy.panel.tableMatchRule')}
                  </TableHead>
                ) : null}
                <TableHead className="h-12 w-[1%] bg-surface-container-low px-5 text-right text-muted-foreground">
                  {t(locale, 'admin.content.common.actions')}
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
                        <Badge variant="secondary">
                          {t(locale, 'admin.taxonomy.panel.usageCount', { count: item.usage })}
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {t(locale, 'admin.content.common.unused')}
                        </span>
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
                          {t(locale, 'admin.content.common.edit')}
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
                            !canDelete
                              ? isSource
                                ? t(locale, 'admin.taxonomy.panel.deleteSourceReserved')
                                : t(locale, 'admin.taxonomy.panel.deleteInUse')
                              : undefined
                          }
                          onClick={() => void handleDelete(item)}
                        >
                          <Trash2 data-icon="inline-start" />
                          {t(locale, 'admin.content.common.delete')}
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
  const { locale } = useLocale();
  const [kind, setKind] = useState<TaxonomyKind>('tag');

  const kindTabs = (Object.keys(KIND_KEYS) as TaxonomyKind[]).map((value) => ({
    value,
    label: taxonomyKindLabel(value, locale),
  }));

  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 mx-auto w-full max-w-6xl">
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold tracking-tight">{t(locale, 'admin.taxonomy.page.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t(locale, 'admin.taxonomy.page.subtitle')}</p>
      </div>

      <Tabs
        value={kind}
        onValueChange={(value) => {
          if (value === 'tag' || value === 'category' || value === 'source') setKind(value);
        }}
      >
        <AdminSegmentedTabsList className="mb-6" aria-label={t(locale, 'admin.taxonomy.page.kindAria')}>
          {kindTabs.map((tab) => (
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
