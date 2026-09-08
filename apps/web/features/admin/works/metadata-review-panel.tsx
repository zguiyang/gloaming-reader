'use client';

import { Pencil } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';

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
import { TaxonomyMultiPicker, TaxonomySelect } from '@/features/admin/taxonomy-picker';
import {
  formatWorksApiError,
  retryAdminWorkflow,
  updateAdminWork,
  useInvalidateAdminWorks,
} from '@/features/admin/works/works-api';
import type { AdminWorkView } from '@/features/admin/works/works-model';
import { cn } from '@/lib/utils';

const PROVENANCE_LABEL: Record<WorkMetadataProvenance, string> = {
  extracted: '提取',
  ai: 'AI 生成',
  manual: '人工',
};

const STEP_LABEL: Record<WorkflowStep, string> = {
  parse: '内容解析',
  metadata: '原数据完善',
  tts: '音频生成',
};

/** Secondary source badges — the ember accent stays reserved for busy/active states. */
function ProvenanceBadge({ provenance }: { provenance?: WorkMetadataProvenance }) {
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
      {PROVENANCE_LABEL[provenance]}
    </Badge>
  );
}

type MetadataFieldRowProps = {
  label: string;
  /** Display value (fallback text when empty). */
  value: string;
  /** Initial edit text — defaults to the display value. */
  editValue?: string;
  multiline?: boolean;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
  provenance?: WorkMetadataProvenance;
  disabled?: boolean;
  onSave: (value: string) => Promise<void>;
};

/**
 * One metadata row in the review panel — display state (value + source badge)
 * toggles into an inline edit form; saving goes through the normal work PATCH
 * (provenance becomes `manual`), and the row re-reads the freshest value.
 */
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
      setError('此字段必填');
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
              {isSaving ? '保存中…' : '保存'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(false)} disabled={isSaving}>
              取消
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
        <p className={cn('mt-1 truncate text-sm', !value && 'text-muted-foreground')}>{value || '未填写'}</p>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={startEdit} disabled={disabled}>
        <Pencil data-icon="inline-start" />
        编辑
      </Button>
    </div>
  );
}

type ReviewPickerRowProps = {
  label: string;
  /** Display value (fallback text when empty). */
  displayValue: string;
  provenance?: WorkMetadataProvenance;
  disabled?: boolean;
  /** Editor rendered while editing — value flows through onChange into parent state. */
  picker: ReactNode;
  onSave: () => Promise<void>;
};

/**
 * Metadata row backed by a taxonomy picker (tags multi-select, category
 * single-select, sources multi-select). Display state mirrors MetadataFieldRow;
 * edit state renders the picker and saves through the normal work PATCH.
 */
function ReviewPickerRow({ label, displayValue, provenance, disabled, picker, onSave }: ReviewPickerRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      await onSave();
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
          {picker}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => void handleSave()} disabled={isSaving}>
              {isSaving ? '保存中…' : '保存'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(false)} disabled={isSaving}>
              取消
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
        <p className={cn('mt-1 truncate text-sm', !displayValue && 'text-muted-foreground')}>
          {displayValue || '未填写'}
        </p>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(true)} disabled={disabled}>
        <Pencil data-icon="inline-start" />
        编辑
      </Button>
    </div>
  );
}

function MetadataReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-3.5">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <p className={cn('mt-1 text-sm', !value && 'text-muted-foreground')}>{value || '—'}</p>
    </div>
  );
}

function WorkBodySummary({ work }: { work: AdminWorkView }) {
  const hasParts = work.parts.length > 0;
  const isProcessing =
    work.status === 'processing' || work.status === 'metadata' || work.status === 'tts' || work.status === 'uploaded';

  if (isProcessing) {
    return <p className="text-sm text-muted-foreground">作品处理中，正文即将更新…</p>;
  }
  if (work.status === 'failed') {
    return (
      <p className="text-sm text-muted-foreground">
        处理失败：{String(work.originMeta.lastError ?? '未知错误')}。可在上方步骤重试解析。
      </p>
    );
  }
  if (hasParts) {
    return (
      <p className="text-sm text-muted-foreground">
        正文由解析生成，包含 {work.parts.length} 个章节，不可在此编辑。
        <Link
          href={ADMIN_ROUTES.workPreview(work.id)}
          className="ml-1 font-medium text-primary underline-offset-4 hover:underline"
        >
          查看预览 →
        </Link>
      </p>
    );
  }
  return <p className="text-sm text-muted-foreground">暂无正文内容。</p>;
}

type MetadataReviewPanelProps = {
  workId: string;
  work: AdminWorkView;
};

/**
 * "原数据完善" step status line + start / retry actions.
 * Busy (`metadata`), idle wait (`parsed` when auto-chain is off), failure,
 * partial gaps, and completion drive what is shown.
 */
export function MetadataStatusCard({ work }: { work: AdminWorkView }) {
  const invalidate = useInvalidateAdminWorks();
  const [isActing, setIsActing] = useState(false);
  const { status, failedStep } = work;

  const metadataAt = typeof work.originMeta.metadataAt === 'string' ? work.originMeta.metadataAt : null;
  const enrichError =
    typeof work.originMeta.metadataEnrichError === 'string' ? work.originMeta.metadataEnrichError : null;
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
      toast.success(status === 'parsed' ? '已开始完善原数据' : '已重新开始处理');
    } catch (error) {
      toast.error(formatWorksApiError(error));
    } finally {
      setIsActing(false);
    }
  }

  let hint = '';
  if (isBusy && status === 'metadata') {
    hint = '正在根据正文内容补全信息，完成后即可逐项核对。';
  } else if (isBusy && status === 'processing') {
    hint = work.workflowPolicy.autoChainEnabled ? '等待内容解析完成后自动完善…' : '等待内容解析完成后再开始完善。';
  } else if (isBusy) {
    hint = '已提交任务，正在排队…';
  } else if (isAwaitingStart) {
    hint = '内容已解析。核对预览无误后，点击开始完善原数据（规则填充 + AI 补全）。';
  } else if (isFailedHere) {
    hint = String(work.originMeta.lastError ?? '原数据完善失败，未知错误');
  } else if (status === 'failed' && failedStep) {
    hint = `「${STEP_LABEL[failedStep]}」步骤失败：${String(work.originMeta.lastError ?? '未知错误')}，可在对应步骤重试。`;
  } else if (status === 'failed') {
    hint = '处理失败：' + String(work.originMeta.lastError ?? '未知错误');
  } else if (isPartial) {
    hint = `${enrichError ?? '部分字段未补全'}。可重新执行或手工编辑；发布时以当前内容为准。`;
  } else if (isDone) {
    hint = 'AI 已自动补全缺失信息，可逐项核对编辑；发布时以当前内容为准。';
  } else if (status === 'ready' || status === 'published' || status === 'tts') {
    hint = '规则层已写入可用字段；可逐项核对编辑。';
  } else {
    hint = work.workflowPolicy.autoChainEnabled
      ? '解析完成后，AI 将自动补全缺失的简介、标签与分类。'
      : '解析完成后，需手动开始完善原数据。';
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
              ? '原数据完善失败'
              : '处理失败'
            : status === 'processing' || status === 'uploaded'
              ? '待完善'
              : status === 'parsed'
                ? '待开始'
                : status === 'metadata' || isActing
                  ? '完善中'
                  : isPartial
                    ? '部分完成'
                    : status === 'published'
                      ? '已完成（已发布）'
                      : isDone
                        ? '已完成'
                        : '待完善'}
        </Badge>
        {metadataAt && (isDone || isPartial) ? (
          <span className="text-xs text-muted-foreground">完善于 {new Date(metadataAt).toLocaleString('zh-CN')}</span>
        ) : null}
      </div>
      <p className={cn('mt-2 text-sm text-muted-foreground', (isFailedHere || isPartial) && 'text-destructive')}>
        {hint}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {isAwaitingStart ? (
          <Button type="button" size="sm" onClick={() => void handleRetry('metadata')} disabled={isActing}>
            {isActing ? '排队中…' : '开始完善原数据'}
          </Button>
        ) : null}
        {isFailedHere ? (
          <Button
            type="button"
            size="sm"
            onClick={() => void handleRetry('metadata', '将重新运行原数据完善（规则填充 + AI 补全），确定继续？')}
            disabled={isActing}
          >
            {isActing ? '排队中…' : '重试'}
          </Button>
        ) : null}
        {status === 'ready' || isPartial ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              void handleRetry('metadata', '将重新运行原数据完善，并覆盖 AI 生成的内容（不含手工编辑），确定继续？')
            }
            disabled={isActing}
          >
            {isActing ? '排队中…' : '重新执行'}
          </Button>
        ) : null}
        {status === 'published' ? (
          <span className="text-xs text-muted-foreground">如需重新完善请先下架作品。</span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * "原数据完善" step — shows the outcome field-by-field with source badges,
 * lets the admin edit in place, and the publish action submits whatever the
 * rows hold at that moment.
 */
export function MetadataReviewPanel({ workId, work }: MetadataReviewPanelProps) {
  const invalidate = useInvalidateAdminWorks();
  const status = work.status;
  const isMetadataJobRunning = status === 'metadata';
  const isEpub = work.originKind === 'admin_epub';
  const hasMetadataSkeleton = isMetadataJobRunning;

  const [tagsDraft, setTagsDraft] = useState<string[]>(work.tags);
  const [sourcesDraft, setSourcesDraft] = useState<string[]>(work.sources);
  const [categoryDraft, setCategoryDraft] = useState<string | null>(work.category);

  async function saveField(patch: UpdateWorkBody) {
    await updateAdminWork(workId, patch);
    await invalidate(workId);
    toast.success('已保存');
  }

  async function saveSuggestedVocabSize(raw: string) {
    const trimmed = raw.trim();
    const parsed = trimmed === '' ? null : Number.parseInt(trimmed, 10);
    if (parsed != null && (!Number.isFinite(parsed) || parsed <= 0)) {
      toast.error('建议词汇量须为正整数');
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
      toast.error(`难度须为 ${DIFFICULTY_SCORE_MIN}–${DIFFICULTY_SCORE_MAX} 的整数`);
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
            label="标题"
            value={work.title}
            required
            maxLength={200}
            disabled={isMetadataJobRunning}
            onSave={(value) => saveField({ title: value })}
          />
          <MetadataFieldRow
            label="作者"
            value={work.author}
            maxLength={200}
            placeholder="可留空"
            disabled={isMetadataJobRunning}
            onSave={(value) => saveField({ author: value })}
          />
          <MetadataFieldRow
            label="简介"
            value={work.description}
            multiline
            maxLength={2000}
            placeholder="作品的简短介绍，展示在发现页"
            provenance={work.metadataProvenance.description}
            disabled={isMetadataJobRunning}
            onSave={(value) => saveField({ description: value })}
          />
          <ReviewPickerRow
            label="标签"
            displayValue={work.tags.length > 0 ? work.tags.join(' · ') : ''}
            provenance={work.metadataProvenance.tags}
            disabled={isMetadataJobRunning}
            picker={
              <TaxonomyMultiPicker
                kind="tag"
                value={tagsDraft}
                onChange={setTagsDraft}
                placeholder="搜索选择标签…"
                disabled={isMetadataJobRunning}
              />
            }
            onSave={async () => saveField({ tags: tagsDraft })}
          />
          <ReviewPickerRow
            label="分类"
            displayValue={work.category ?? ''}
            provenance={work.metadataProvenance.category}
            disabled={isMetadataJobRunning}
            picker={
              <TaxonomySelect
                value={categoryDraft}
                onChange={setCategoryDraft}
                placeholder="选择分类…"
                allowClear
                disabled={isMetadataJobRunning}
              />
            }
            onSave={async () => saveField({ category: categoryDraft ?? '' })}
          />
          <ReviewPickerRow
            label="来源"
            displayValue={work.sources.length > 0 ? work.sources.join(' · ') : ''}
            disabled={isMetadataJobRunning}
            picker={
              <TaxonomyMultiPicker
                kind="source"
                value={sourcesDraft}
                onChange={setSourcesDraft}
                placeholder="搜索选择来源…（留空表示未知）"
                disabled={isMetadataJobRunning}
              />
            }
            onSave={async () => saveField({ sources: sourcesDraft })}
          />
          <MetadataReadOnlyRow
            label="总字数"
            value={work.wordCount != null ? work.wordCount.toLocaleString('en-US') : ''}
          />
          <MetadataReadOnlyRow
            label="预计阅读时间"
            value={work.estimatedMinutes != null ? `${work.estimatedMinutes} 分钟` : ''}
          />
          <MetadataFieldRow
            label="建议词汇量"
            value={suggestedVocabDisplay}
            editValue={work.suggestedVocabSize != null ? String(work.suggestedVocabSize) : ''}
            placeholder="如 4000"
            disabled={isMetadataJobRunning}
            onSave={saveSuggestedVocabSize}
          />
          <MetadataFieldRow
            label="难度（1–5）"
            value={difficultyDisplay}
            editValue={work.difficultyScore != null ? String(work.difficultyScore) : ''}
            placeholder={`${DIFFICULTY_SCORE_MIN}–${DIFFICULTY_SCORE_MAX}`}
            disabled={isMetadataJobRunning}
            onSave={saveDifficultyScore}
          />
          {work.statsProvenance === 'manual' ? (
            <p className="py-3 text-xs text-muted-foreground">难度与建议词汇量为手动覆盖；重新解析不会改写这两项。</p>
          ) : null}
          <div className="py-3.5">
            <span className="text-sm font-medium text-muted-foreground">正文</span>
            <div className="mt-1">
              <WorkBodySummary work={work} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
