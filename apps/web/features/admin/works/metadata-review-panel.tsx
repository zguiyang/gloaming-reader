'use client';

import { Pencil } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';

import { type Locale, t } from '@gloaming/i18n';
import { DIFFICULTY_SCORE_MAX, DIFFICULTY_SCORE_MIN, difficultyLabelFromScore } from '@gloaming/shared/reading-stats';
import { type UpdateWorkBody, type WorkflowStep, type WorkMetadataProvenance } from '@gloaming/shared/works';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ADMIN_ROUTES } from '@/constants';
import { formatAdminDateTime } from '@/features/admin/admin-logs-format';
import { TaxonomyMultiPicker, TaxonomySelect } from '@/features/admin/taxonomy/taxonomy-picker';
import { SourceReferenceReview, TaxonomyReferenceReview } from '@/features/admin/works/taxonomy-reference-review';
import {
  formatWorksApiError,
  retryAdminWorkflow,
  updateAdminWork,
  useInvalidateAdminWorks,
} from '@/features/admin/works/works-api';
import { formatProvenance, formatWorkflowStep } from '@/features/admin/works/works-format';
import type { AdminWorkView } from '@/features/admin/works/works-model';
import {
  categoryReferenceId,
  categoryReviewItems,
  taxonomyReferenceIds,
  toTaxonomySelection,
  toTaxonomySelections,
} from '@/features/admin/works/works-taxonomy';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

function ProvenanceBadge({ provenance }: { provenance?: WorkMetadataProvenance }) {
  const { locale } = useLocale();

  if (!provenance) {
    return null;
  }
  return (
    <Badge
      variant="outline"
      className={cn(
        provenance === 'ai' && 'border-transparent bg-brand-soft text-brand-deep',
        provenance === 'manual' && 'border-transparent bg-secondary text-secondary-foreground',
        provenance === 'extracted' && 'text-muted-foreground',
      )}
    >
      {formatProvenance(provenance, locale)}
    </Badge>
  );
}

function formatMetadataGapSummary(gaps: string[], locale: Locale): string {
  const labels = gaps.map((gap) => t(locale, `admin.works.metadata.gap.${gap}`));
  return labels.length > 0
    ? t(locale, 'admin.works.metadata.partialFields', {
        fields: labels.join(locale === 'zh-CN' ? '、' : ', '),
      })
    : t(locale, 'admin.works.metadata.hintPartialDefault');
}

type MetadataFieldRowProps = {
  label: string;
  value: string;
  editValue?: string;
  multiline?: boolean;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
  provenance?: WorkMetadataProvenance;
  disabled?: boolean;
  onSave: (value: string) => Promise<void>;
};

function MetadataFieldRow({
  label,
  value,
  editValue,
  multiline,
  required,
  maxLength,
  placeholder,
  provenance,
  disabled,
  onSave,
}: MetadataFieldRowProps) {
  const { locale } = useLocale();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setDraft(editValue ?? value);
    setError(null);
    setIsEditing(true);
  }

  async function handleSave() {
    const text = draft.trim();
    if (required && !text) {
      setError(t(locale, 'admin.content.common.required'));
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await onSave(text);
      setIsEditing(false);
    } catch (saveError) {
      setError(formatWorksApiError(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  if (isEditing) {
    return (
      <div className="py-3.5">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label>
              {label}
              {required ? <span className="ml-0.5 text-destructive">*</span> : null}
            </Label>
            <ProvenanceBadge provenance={provenance} />
          </div>
          {multiline ? (
            <Textarea
              value={draft}
              maxLength={maxLength}
              placeholder={placeholder}
              aria-invalid={Boolean(error) || undefined}
              onChange={(event) => setDraft(event.target.value)}
            />
          ) : (
            <Input
              value={draft}
              maxLength={maxLength}
              placeholder={placeholder}
              aria-invalid={Boolean(error) || undefined}
              onChange={(event) => setDraft(event.target.value)}
            />
          )}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => void handleSave()} disabled={isSaving}>
              {isSaving ? t(locale, 'admin.content.common.saving') : t(locale, 'admin.content.common.save')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(false)} disabled={isSaving}>
              {t(locale, 'admin.content.common.cancel')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          <ProvenanceBadge provenance={provenance} />
        </div>
        <p className={cn('mt-1 truncate text-sm', !value && 'text-muted-foreground')}>
          {value || t(locale, 'admin.content.common.notFilled')}
        </p>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={startEdit} disabled={disabled}>
        <Pencil data-icon="inline-start" />
        {t(locale, 'admin.content.common.edit')}
      </Button>
    </div>
  );
}

type ReviewPickerRowProps<T> = {
  label: string;
  review: ReactNode;
  value: T;
  provenance?: WorkMetadataProvenance;
  disabled?: boolean;
  renderPicker: (value: T, onChange: (value: T) => void) => ReactNode;
  onSave: (value: T) => Promise<void>;
};

function ReviewPickerRow<T>({
  label,
  review,
  value,
  provenance,
  disabled,
  renderPicker,
  onSave,
}: ReviewPickerRowProps<T>) {
  const { locale } = useLocale();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setDraft(value);
    setError(null);
    setIsEditing(true);
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setIsEditing(false);
    } catch (saveError) {
      setError(formatWorksApiError(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  if (isEditing) {
    return (
      <div className="py-3.5">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label>
              {label}
              <ProvenanceBadge provenance={provenance} />
            </Label>
          </div>
          {renderPicker(draft, setDraft)}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => void handleSave()} disabled={isSaving}>
              {isSaving ? t(locale, 'admin.content.common.saving') : t(locale, 'admin.content.common.save')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(false)} disabled={isSaving}>
              {t(locale, 'admin.content.common.cancel')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          <ProvenanceBadge provenance={provenance} />
        </div>
        <div className="mt-1">{review}</div>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={startEdit} disabled={disabled}>
        <Pencil data-icon="inline-start" />
        {t(locale, 'admin.content.common.edit')}
      </Button>
    </div>
  );
}

function MetadataReadOnlyRow({ label, value }: { label: string; value: string }) {
  const { locale } = useLocale();

  return (
    <div className="py-3.5">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <p className={cn('mt-1 text-sm', !value && 'text-muted-foreground')}>
        {value || t(locale, 'admin.logs.emptyValue')}
      </p>
    </div>
  );
}

function WorkBodySummary({ work }: { work: AdminWorkView }) {
  const { locale } = useLocale();
  const hasParts = work.parts.length > 0;
  const isProcessing =
    work.status === 'processing' || work.status === 'metadata' || work.status === 'tts' || work.status === 'uploaded';
  const unknownError = t(locale, 'admin.works.edit.unknownError');

  if (isProcessing) {
    return <p className="text-sm text-muted-foreground">{t(locale, 'admin.works.metadata.processingBody')}</p>;
  }
  if (work.status === 'failed') {
    return (
      <p className="text-sm text-muted-foreground">
        {t(locale, 'admin.works.metadata.failedBody', {
          error: String(work.originMeta.lastError ?? unknownError),
        })}
      </p>
    );
  }
  if (hasParts) {
    return (
      <p className="text-sm text-muted-foreground">
        {t(locale, 'admin.works.metadata.bodyFromParse', { count: work.parts.length })}
        <Link
          href={ADMIN_ROUTES.workPreview(work.id)}
          className="ml-1 font-medium text-primary underline-offset-4 hover:underline"
        >
          {t(locale, 'admin.works.metadata.viewPreview')}
        </Link>
      </p>
    );
  }
  return <p className="text-sm text-muted-foreground">{t(locale, 'admin.works.metadata.noBody')}</p>;
}

type MetadataReviewPanelProps = {
  workId: string;
  work: AdminWorkView;
};

export function MetadataStatusCard({ work }: { work: AdminWorkView }) {
  const { locale } = useLocale();
  const invalidate = useInvalidateAdminWorks();
  const [isActing, setIsActing] = useState(false);
  const { status, failedStep } = work;
  const unknownError = t(locale, 'admin.works.edit.unknownError');

  const metadataAt = typeof work.originMeta.metadataAt === 'string' ? work.originMeta.metadataAt : null;
  const enrichGaps = Array.isArray(work.originMeta.metadataEnrichGaps)
    ? work.originMeta.metadataEnrichGaps.filter((item): item is string => typeof item === 'string')
    : [];
  const isBusy = status === 'processing' || status === 'metadata' || isActing;
  const isAwaitingStart = status === 'parsed';
  const isFailedHere = status === 'failed' && failedStep === 'metadata';
  const isPartial = (status === 'ready' || status === 'tts') && enrichGaps.length > 0;
  const isDone =
    (status === 'ready' || status === 'published' || status === 'tts') &&
    enrichGaps.length === 0 &&
    Boolean(metadataAt);

  async function handleRetry(step: WorkflowStep, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setIsActing(true);
    try {
      await retryAdminWorkflow(work.id, step);
      await invalidate(work.id);
      toast.success(
        status === 'parsed'
          ? t(locale, 'admin.works.metadata.enrichStarted')
          : t(locale, 'admin.works.metadata.enrichRestarted'),
      );
    } catch (error) {
      toast.error(formatWorksApiError(error));
    } finally {
      setIsActing(false);
    }
  }

  let hint = '';
  if (isBusy && status === 'metadata') {
    hint = t(locale, 'admin.works.metadata.hintEnriching');
  } else if (isBusy && status === 'processing') {
    hint = work.workflowPolicy.autoChainEnabled
      ? t(locale, 'admin.works.metadata.hintWaitingParseAuto')
      : t(locale, 'admin.works.metadata.hintWaitingParseManual');
  } else if (isBusy) {
    hint = t(locale, 'admin.works.metadata.hintQueued');
  } else if (isAwaitingStart) {
    hint = t(locale, 'admin.works.metadata.hintAwaitingStart');
  } else if (isFailedHere) {
    hint = t(locale, 'admin.works.metadata.hintFailedHere', {
      error: String(work.originMeta.lastError ?? unknownError),
    });
  } else if (status === 'failed' && failedStep) {
    hint = t(locale, 'admin.works.metadata.hintStepFailed', {
      step: formatWorkflowStep(failedStep, locale),
      error: String(work.originMeta.lastError ?? unknownError),
    });
  } else if (status === 'failed') {
    hint = t(locale, 'admin.works.metadata.hintFailedGeneric', {
      error: String(work.originMeta.lastError ?? unknownError),
    });
  } else if (isPartial) {
    hint = t(locale, 'admin.works.metadata.hintPartial', {
      error: formatMetadataGapSummary(enrichGaps, locale),
    });
  } else if (isDone) {
    hint = t(locale, 'admin.works.metadata.hintDone');
  } else if (status === 'ready' || status === 'published' || status === 'tts') {
    hint = t(locale, 'admin.works.metadata.hintRulesOnly');
  } else {
    hint = work.workflowPolicy.autoChainEnabled
      ? t(locale, 'admin.works.metadata.hintAutoFuture')
      : t(locale, 'admin.works.metadata.hintManualFuture');
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {status === 'metadata' || isActing ? <Spinner className="size-4 text-brand" /> : null}
        <Badge
          variant={
            status === 'failed' || isPartial
              ? 'destructive'
              : isDone || status === 'published'
                ? 'secondary'
                : 'outline'
          }
        >
          {status === 'failed'
            ? isFailedHere
              ? t(locale, 'admin.works.metadata.statusFailed')
              : t(locale, 'admin.works.metadata.statusFailedGeneric')
            : status === 'processing' || status === 'uploaded'
              ? t(locale, 'admin.works.metadata.statusPending')
              : status === 'parsed'
                ? t(locale, 'admin.works.metadata.statusAwaitingStart')
                : status === 'metadata' || isActing
                  ? t(locale, 'admin.works.metadata.statusEnriching')
                  : isPartial
                    ? t(locale, 'admin.works.metadata.statusPartial')
                    : status === 'published'
                      ? t(locale, 'admin.works.metadata.statusDonePublished')
                      : isDone
                        ? t(locale, 'admin.works.metadata.statusDone')
                        : t(locale, 'admin.works.metadata.statusPending')}
        </Badge>
        {metadataAt && (isDone || isPartial) ? (
          <span className="text-xs text-muted-foreground">
            {t(locale, 'admin.works.metadata.enrichedAt', { time: formatAdminDateTime(metadataAt, locale) })}
          </span>
        ) : null}
      </div>
      <p className={cn('mt-2 text-sm text-muted-foreground', (isFailedHere || isPartial) && 'text-destructive')}>
        {hint}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {isAwaitingStart ? (
          <Button type="button" size="sm" onClick={() => void handleRetry('metadata')} disabled={isActing}>
            {isActing ? t(locale, 'admin.content.common.queuing') : t(locale, 'admin.works.metadata.startEnrich')}
          </Button>
        ) : null}
        {isFailedHere ? (
          <Button
            type="button"
            size="sm"
            onClick={() => void handleRetry('metadata', t(locale, 'admin.works.metadata.confirmReEnrich'))}
            disabled={isActing}
          >
            {isActing ? t(locale, 'admin.content.common.queuing') : t(locale, 'content.common.retry')}
          </Button>
        ) : null}
        {status === 'ready' || isPartial ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void handleRetry('metadata', t(locale, 'admin.works.metadata.confirmReEnrichReady'))}
            disabled={isActing}
          >
            {isActing ? t(locale, 'admin.content.common.queuing') : t(locale, 'admin.works.metadata.reRun')}
          </Button>
        ) : null}
        {status === 'published' ? (
          <span className="text-xs text-muted-foreground">{t(locale, 'admin.works.metadata.unpublishToReEnrich')}</span>
        ) : null}
      </div>
    </div>
  );
}

export function MetadataReviewPanel({ workId, work }: MetadataReviewPanelProps) {
  const { locale } = useLocale();
  const invalidate = useInvalidateAdminWorks();
  const status = work.status;
  const isMetadataJobRunning = status === 'metadata';
  const isEpub = work.originKind === 'admin_epub';
  const hasMetadataSkeleton = isMetadataJobRunning;

  const tagIds = taxonomyReferenceIds(work.tags);
  const sourceIds = taxonomyReferenceIds(work.sources);
  const categoryId = categoryReferenceId(work.category);

  async function saveField(patch: UpdateWorkBody) {
    await updateAdminWork(workId, patch);
    await invalidate(workId);
    toast.success(t(locale, 'admin.content.common.saved'));
  }

  async function saveSuggestedVocabSize(raw: string) {
    const trimmed = raw.trim();
    const parsed = trimmed === '' ? null : Number.parseInt(trimmed, 10);
    if (parsed != null && (!Number.isFinite(parsed) || parsed <= 0)) {
      toast.error(t(locale, 'admin.works.metadata.vocabMustBePositive'));
      throw new Error('validation');
    }
    await saveField({ suggestedVocabSize: parsed });
  }

  async function saveDifficultyScore(raw: string) {
    const trimmed = raw.trim();
    const parsed = trimmed === '' ? null : Number.parseInt(trimmed, 10);
    if (
      parsed != null &&
      (!Number.isFinite(parsed) || parsed < DIFFICULTY_SCORE_MIN || parsed > DIFFICULTY_SCORE_MAX)
    ) {
      toast.error(
        t(locale, 'admin.works.metadata.difficultyRange', {
          min: DIFFICULTY_SCORE_MIN,
          max: DIFFICULTY_SCORE_MAX,
        }),
      );
      throw new Error('validation');
    }
    await saveField({ difficultyScore: parsed });
  }

  const suggestedVocabDisplay = work.suggestedVocabSize != null ? String(work.suggestedVocabSize) : '';
  const difficultyDisplay =
    work.difficultyScore != null ? `${work.difficultyScore}（${difficultyLabelFromScore(work.difficultyScore)}）` : '';

  return (
    <div className="mt-4">
      {isEpub ? <MetadataStatusCard work={work} /> : null}

      {hasMetadataSkeleton ? (
        <div className="mt-4 space-y-3" aria-busy="true">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-12 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="mt-4 divide-y divide-border rounded-2xl border border-border bg-background/40 px-4">
          <MetadataFieldRow
            label={t(locale, 'admin.works.metadata.fieldTitle')}
            value={work.title}
            required
            maxLength={200}
            disabled={isMetadataJobRunning}
            onSave={(value) => saveField({ title: value })}
          />
          <MetadataFieldRow
            label={t(locale, 'admin.works.metadata.fieldAuthor')}
            value={work.author}
            maxLength={200}
            placeholder={t(locale, 'admin.works.metadata.authorOptional')}
            disabled={isMetadataJobRunning}
            onSave={(value) => saveField({ author: value })}
          />
          <MetadataFieldRow
            label={t(locale, 'admin.works.metadata.fieldDescription')}
            value={work.description}
            multiline
            maxLength={2000}
            placeholder={t(locale, 'admin.works.metadata.descriptionPlaceholder')}
            provenance={work.metadataProvenance.description}
            disabled={isMetadataJobRunning}
            onSave={(value) => saveField({ description: value })}
          />
          <ReviewPickerRow
            label={t(locale, 'admin.works.metadata.fieldTags')}
            review={<TaxonomyReferenceReview items={work.tags} />}
            value={tagIds}
            provenance={work.metadataProvenance.tags}
            disabled={isMetadataJobRunning}
            renderPicker={(draft, onChange) => (
              <TaxonomyMultiPicker
                kind="tag"
                value={draft}
                onChange={onChange}
                placeholder={t(locale, 'admin.works.metadata.tagsPlaceholder')}
                disabled={isMetadataJobRunning}
              />
            )}
            onSave={async (draft) => saveField({ tags: toTaxonomySelections(draft) })}
          />
          <ReviewPickerRow
            label={t(locale, 'admin.works.metadata.fieldCategory')}
            review={<TaxonomyReferenceReview items={categoryReviewItems(work.category)} />}
            value={categoryId}
            provenance={work.metadataProvenance.category}
            disabled={isMetadataJobRunning}
            renderPicker={(draft, onChange) => (
              <TaxonomySelect
                value={draft}
                onChange={onChange}
                placeholder={t(locale, 'admin.works.metadata.categoryPlaceholder')}
                allowClear
                disabled={isMetadataJobRunning}
              />
            )}
            onSave={async (draft) => saveField({ category: toTaxonomySelection(draft) })}
          />
          <ReviewPickerRow
            label={t(locale, 'admin.works.metadata.fieldSources')}
            review={<SourceReferenceReview items={work.sources} />}
            value={sourceIds}
            disabled={isMetadataJobRunning}
            renderPicker={(draft, onChange) => (
              <TaxonomyMultiPicker
                kind="source"
                value={draft}
                onChange={onChange}
                placeholder={t(locale, 'admin.works.metadata.sourcesPlaceholder')}
                disabled={isMetadataJobRunning}
              />
            )}
            onSave={async (draft) => saveField({ sources: toTaxonomySelections(draft) })}
          />
          <MetadataReadOnlyRow
            label={t(locale, 'admin.works.metadata.fieldWordCount')}
            value={work.wordCount != null ? work.wordCount.toLocaleString(locale) : ''}
          />
          <MetadataReadOnlyRow
            label={t(locale, 'admin.works.metadata.fieldEstimatedMinutes')}
            value={
              work.estimatedMinutes != null
                ? t(locale, 'admin.works.metadata.minutesUnit', { minutes: work.estimatedMinutes })
                : ''
            }
          />
          <MetadataFieldRow
            label={t(locale, 'admin.works.metadata.fieldSuggestedVocab')}
            value={suggestedVocabDisplay}
            editValue={work.suggestedVocabSize != null ? String(work.suggestedVocabSize) : ''}
            placeholder={t(locale, 'admin.works.metadata.suggestedVocabPlaceholder')}
            disabled={isMetadataJobRunning}
            onSave={saveSuggestedVocabSize}
          />
          <MetadataFieldRow
            label={t(locale, 'admin.works.metadata.fieldDifficulty')}
            value={difficultyDisplay}
            editValue={work.difficultyScore != null ? String(work.difficultyScore) : ''}
            placeholder={`${DIFFICULTY_SCORE_MIN}–${DIFFICULTY_SCORE_MAX}`}
            disabled={isMetadataJobRunning}
            onSave={saveDifficultyScore}
          />
          {work.statsProvenance === 'manual' ? (
            <p className="py-3 text-xs text-muted-foreground">{t(locale, 'admin.works.metadata.manualStatsHint')}</p>
          ) : null}
          <div className="py-3.5">
            <span className="text-sm font-medium text-muted-foreground">
              {t(locale, 'admin.works.metadata.fieldBody')}
            </span>
            <div className="mt-1">
              <WorkBodySummary work={work} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
