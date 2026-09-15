'use client';

import { FolderOpen, Link2, PencilLine, Plus, Search, Tags, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { t } from '@gloaming/i18n';
import type { TaxonomyItem, TaxonomyItemResult, TaxonomyKind, TaxonomyOrigin } from '@gloaming/shared/taxonomy';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import {
  buildTaxonomyNamesPayload,
  filterTaxonomyItems,
  formatTaxonomyConfirmName,
  formatTaxonomyLocaleCell,
  formatTaxonomyOrigin,
  formatTaxonomyUpdatedAt,
  formatTranslationStatusLabel,
  getTranslationStatus,
  type TranslationFilter,
} from '@/features/admin/taxonomy/taxonomy-format';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

const KIND_KEYS: Record<TaxonomyKind, string> = {
  tag: 'tag',
  category: 'category',
  source: 'source',
};

const TABLE_COLUMN_COUNT = 8;

function OriginBadge({ origin }: { origin: TaxonomyOrigin }) {
  const { locale } = useLocale();

  return (
    <Badge
      variant="outline"
      className={cn(
        origin === 'ai' && 'border-transparent bg-brand-soft text-brand-deep',
        origin === 'extracted' && 'text-muted-foreground',
      )}
    >
      {formatTaxonomyOrigin(origin, locale)}
    </Badge>
  );
}

function TranslationStatusBadge({ item }: { item: TaxonomyItem }) {
  const { locale } = useLocale();
  const status = getTranslationStatus(item.names);

  return (
    <Badge variant={status === 'complete' ? 'secondary' : 'outline'}>
      {formatTranslationStatusLabel(status, locale)}
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
  item: TaxonomyItemResult | null;
  onClose: () => void;
};

function TaxonomySheet({ kind, item, onClose }: TaxonomySheetProps) {
  const { locale } = useLocale();
  const createMutation = useCreateTaxonomy(kind);
  const updateMutation = useUpdateTaxonomy(kind);
  const isEdit = item !== null;
  const [name, setName] = useState(item && 'name' in item ? item.name : '');
  const [nameZh, setNameZh] = useState(item && 'names' in item ? (item.names['zh-CN'] ?? '') : '');
  const [nameEn, setNameEn] = useState(item && 'names' in item ? (item.names['en-US'] ?? '') : '');
  const [matchRule, setMatchRule] = useState(item && 'matchRule' in item ? (item.matchRule ?? '') : '');
  const [error, setError] = useState<string | null>(null);
  const isPending = createMutation.isPending || updateMutation.isPending;

  async function handleSubmit() {
    if (kind === 'source') {
      const sourceName = name.trim();
      if (!sourceName) {
        setError(t(locale, 'admin.content.common.nameRequired'));
        return;
      }
      setError(null);
      try {
        if (isEdit) {
          await updateMutation.mutateAsync({
            id: item.id,
            body: { name: sourceName, matchRule: matchRule.trim() },
          });
        } else {
          await createMutation.mutateAsync({ name: sourceName, matchRule: matchRule.trim() });
        }
        toast.success(isEdit ? t(locale, 'admin.content.common.saved') : t(locale, 'admin.content.common.created'));
        onClose();
      } catch (submitError) {
        setError(formatTaxonomyApiError(submitError));
      }
      return;
    }
    const names = buildTaxonomyNamesPayload(nameZh, nameEn);
    if (!names) {
      setError(t(locale, 'admin.content.common.nameRequired'));
      return;
    }
    setError(null);
    try {
      if (isEdit) {
        await updateMutation.mutateAsync({
          id: item.id,
          body: {
            names,
          },
        });
      } else {
        await createMutation.mutateAsync({
          names,
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
            {kind === 'source' ? (
              <Field>
                <FieldLabel htmlFor="taxonomy-source-name">{t(locale, 'admin.taxonomy.panel.tableName')}</FieldLabel>
                <Input
                  id="taxonomy-source-name"
                  value={name}
                  maxLength={100}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t(locale, 'admin.taxonomy.sheet.sourceNamePlaceholder')}
                />
              </Field>
            ) : (
              <>
                <Field>
                  <FieldLabel htmlFor="taxonomy-name-zh">{t(locale, 'admin.taxonomy.sheet.nameZhLabel')}</FieldLabel>
                  <Input
                    id="taxonomy-name-zh"
                    value={nameZh}
                    maxLength={100}
                    onChange={(event) => setNameZh(event.target.value)}
                    placeholder={t(locale, 'admin.taxonomy.sheet.genericNamePlaceholder')}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="taxonomy-name-en">{t(locale, 'admin.taxonomy.sheet.nameEnLabel')}</FieldLabel>
                  <Input
                    id="taxonomy-name-en"
                    value={nameEn}
                    maxLength={100}
                    onChange={(event) => setNameEn(event.target.value)}
                    placeholder={t(locale, 'admin.taxonomy.sheet.sourceNamePlaceholder')}
                  />
                </Field>
              </>
            )}
            <Field data-invalid={Boolean(error) || undefined}>
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

function TaxonomyTableSkeleton() {
  return (
    <Table aria-hidden>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {Array.from({ length: TABLE_COLUMN_COUNT }, (_, index) => (
            <TableHead key={index} className="h-12 bg-surface-container-low px-5 text-muted-foreground">
              <Skeleton className="h-4 w-20 bg-muted/70" />
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 4 }, (_, rowIndex) => (
          <TableRow key={rowIndex} className="border-border hover:bg-transparent">
            {Array.from({ length: TABLE_COLUMN_COUNT }, (_, colIndex) => (
              <TableCell key={colIndex} className="px-5 py-4">
                <Skeleton className="h-4 w-32 max-w-full bg-muted/70" />
              </TableCell>
            ))}
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
  const [translationFilter, setTranslationFilter] = useState<TranslationFilter>('all');
  const [sheetState, setSheetState] = useState<{ open: boolean; item: TaxonomyItemResult | null }>({
    open: false,
    item: null,
  });
  const query = useTaxonomyQuery(kind);
  const deleteMutation = useDeleteTaxonomy(kind);
  const cleanupMutation = useCleanupTaxonomy();
  const isSource = kind === 'source';
  const kindLabel = taxonomyKindLabel(kind, locale);

  const filteredItems = useMemo(
    () => filterTaxonomyItems(query.data ?? [], { search, translationFilter }),
    [query.data, search, translationFilter],
  );

  const translationFilterOptions: { value: TranslationFilter; label: string }[] = [
    {
      value: 'all',
      label: t(locale, 'admin.taxonomy.panel.translationFilterAll'),
    },
    {
      value: 'complete',
      label: t(locale, 'admin.taxonomy.panel.translationFilterComplete'),
    },
    {
      value: 'partial',
      label: t(locale, 'admin.taxonomy.panel.translationFilterPartial'),
    },
  ];

  async function handleDelete(item: TaxonomyItemResult) {
    const displayName = 'name' in item ? item.name : formatTaxonomyConfirmName(item.names, locale);
    if (!window.confirm(t(locale, 'admin.taxonomy.panel.confirmDelete', { name: displayName }))) return;
    try {
      await deleteMutation.mutateAsync(item.id);
      toast.success(t(locale, 'admin.content.common.deleted'));
    } catch (error) {
      toast.error(formatTaxonomyApiError(error));
    }
  }

  async function handleCleanup() {
    const cleanupKey =
      kind === 'tag' ? 'admin.taxonomy.panel.confirmCleanupTag' : 'admin.taxonomy.panel.confirmCleanupCategory';
    if (!window.confirm(t(locale, cleanupKey))) return;
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

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
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
            <Select
              items={translationFilterOptions}
              value={translationFilter}
              onValueChange={(value) => value && setTranslationFilter(value as TranslationFilter)}
            >
              <SelectTrigger size="sm" className="min-w-[8.5rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {translationFilterOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : null}
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
        <TaxonomyTableSkeleton />
      ) : filteredItems.length === 0 ? (
        <Empty className="border-0 py-16">
          <EmptyMedia variant="icon">{isSource ? <Link2 /> : kind === 'tag' ? <Tags /> : <FolderOpen />}</EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>
              {search || translationFilter !== 'all'
                ? t(locale, 'admin.taxonomy.panel.emptyNoMatchSearch')
                : t(locale, 'admin.taxonomy.panel.emptyNoMatch', { kind: kindLabel })}
            </EmptyTitle>
            {search || translationFilter !== 'all' || isSource ? (
              <EmptyDescription>
                {search || translationFilter !== 'all'
                  ? t(locale, 'admin.taxonomy.panel.emptySearchHint')
                  : t(locale, 'admin.taxonomy.panel.emptySourceHint')}
              </EmptyDescription>
            ) : null}
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-12 w-[1%] bg-surface-container-low px-5 text-muted-foreground">
                  {t(locale, 'admin.taxonomy.panel.tableIndex')}
                </TableHead>
                {isSource ? (
                  <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
                    {t(locale, 'admin.taxonomy.panel.tableName')}
                  </TableHead>
                ) : (
                  <>
                    <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
                      {t(locale, 'admin.taxonomy.panel.tableChinese')}
                    </TableHead>
                    <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
                      {t(locale, 'admin.taxonomy.panel.tableEnglish')}
                    </TableHead>
                    <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
                      {t(locale, 'admin.taxonomy.panel.tableTranslationStatus')}
                    </TableHead>
                  </>
                )}
                <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
                  {t(locale, 'admin.taxonomy.panel.tableOrigin')}
                </TableHead>
                <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
                  {t(locale, 'admin.taxonomy.panel.tableUsage')}
                </TableHead>
                <TableHead className="h-12 bg-surface-container-low px-5 text-muted-foreground">
                  {t(locale, 'admin.taxonomy.panel.tableUpdatedAt')}
                </TableHead>
                <TableHead className="h-12 w-[1%] bg-surface-container-low px-5 text-right text-muted-foreground">
                  {t(locale, 'admin.content.common.actions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.map((item, index) => {
                const canDelete = !isSource && item.usage === 0;
                const localizedItem = 'names' in item ? item : null;
                const zhCell = localizedItem ? formatTaxonomyLocaleCell(localizedItem.names, 'zh-CN', locale) : null;
                const enCell = localizedItem ? formatTaxonomyLocaleCell(localizedItem.names, 'en-US', locale) : null;
                const isZhMissing = localizedItem ? !localizedItem.names['zh-CN']?.trim() : false;
                const isEnMissing = localizedItem ? !localizedItem.names['en-US']?.trim() : false;

                return (
                  <TableRow key={item.id} className="border-border">
                    <TableCell className="px-5 py-3.5 tabular-nums text-muted-foreground">{index + 1}</TableCell>
                    {localizedItem ? (
                      <>
                        <TableCell className={cn('px-5 py-3.5', isZhMissing ? 'text-muted-foreground' : 'font-medium')}>
                          {zhCell}
                        </TableCell>
                        <TableCell className={cn('px-5 py-3.5', isEnMissing ? 'text-muted-foreground' : 'font-medium')}>
                          {enCell}
                        </TableCell>
                        <TableCell className="px-5 py-3.5">
                          <TranslationStatusBadge item={localizedItem} />
                        </TableCell>
                      </>
                    ) : (
                      <TableCell className="px-5 py-3.5 font-medium">{'name' in item ? item.name : item.id}</TableCell>
                    )}
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
                    <TableCell className="px-5 py-3.5 text-sm text-muted-foreground tabular-nums">
                      {formatTaxonomyUpdatedAt(item.updatedAt, locale)}
                    </TableCell>
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
