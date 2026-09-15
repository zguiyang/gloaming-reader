'use client';

import { AudioLines, BookOpen, Check, FileText, ListTree, Send, Sparkles, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { type Locale, t } from '@gloaming/i18n';
import {
  type CreateEpubWorkResult,
  EPUB_UPLOAD_MAX_BYTES,
  type PublishWorkIssue,
  type WorkflowStep,
} from '@gloaming/shared/works';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ADMIN_ROUTES } from '@/constants';
import { MetadataReviewPanel } from '@/features/admin/works/metadata-review-panel';
import { WorkAudioPanel } from '@/features/admin/works/work-audio-panel';
import {
  checkEpubWorkReuse,
  deleteAdminWork,
  formatWorksApiError,
  publishAdminWork,
  retryAdminWorkflow,
  unpublishAdminWork,
  uploadAdminEpub,
  useAdminWorkQuery,
  useInvalidateAdminWorks,
} from '@/features/admin/works/works-api';
import { formatWorkflowStep, formatWorkStatus, workflowModeLabels } from '@/features/admin/works/works-format';
import { type AdminWorkView, canPreviewWork } from '@/features/admin/works/works-model';
import { useLocale } from '@/lib/locale-context';
import { cn } from '@/lib/utils';

const WORKFLOW_STEP_IDS = ['upload', 'parse', 'metadata', 'audio', 'publish'] as const;

type WorkflowStepId = (typeof WORKFLOW_STEP_IDS)[number];

type StepState = 'done' | 'active' | 'todo' | 'failed' | 'na';

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function sha256File(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validateEpubFile(file: File, locale: Locale): string | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (extension !== 'epub') {
    return t(locale, 'admin.works.edit.invalidFormat', { fileName: file.name });
  }
  if (file.size > EPUB_UPLOAD_MAX_BYTES) {
    return t(locale, 'admin.works.edit.fileTooLarge', { fileName: file.name });
  }
  return null;
}

function formatPublishIssue(issue: PublishWorkIssue, locale: Locale): string {
  return t(locale, issue.code, issue.params);
}

function stepStates(work: AdminWorkView | null): Record<WorkflowStepId, StepState> {
  if (!work) {
    return { upload: 'active', parse: 'todo', metadata: 'todo', audio: 'todo', publish: 'todo' };
  }
  if (work.originKind === 'admin_text') {
    return {
      upload: 'na',
      parse: 'na',
      metadata: work.status === 'published' ? 'done' : 'active',
      audio: 'na',
      publish: work.status === 'published' ? 'done' : 'active',
    };
  }
  // Parse — active while running, or waiting for the admin to start (manual mode).
  const parseState =
    work.status === 'processing'
      ? 'active'
      : work.status === 'uploaded'
        ? 'active'
        : work.status === 'failed' && work.failedStep === 'parse'
          ? 'failed'
          : work.originMeta.parsed
            ? 'done'
            : 'todo';
  // Metadata — active while jobs run, or waiting after parse in manual mode.
  const metadataState =
    work.status === 'metadata'
      ? 'active'
      : work.status === 'parsed'
        ? 'active'
        : work.status === 'failed' && work.failedStep === 'metadata'
          ? 'failed'
          : work.status === 'tts' ||
              work.status === 'ready' ||
              work.status === 'published' ||
              Boolean(work.originMeta.metadataAt)
            ? 'done'
            : 'todo';
  // Audio — manual generation via WorkAudioPanel; done when server publish gate passes for default US audio.
  const audioGateIssues = work.publishIssues.filter((issue) => issue.path.includes('.audio.'));
  const audioState =
    work.status === 'tts'
      ? 'active'
      : work.originKind === 'admin_epub' && work.parts.length > 0
        ? audioGateIssues.length === 0
          ? 'done'
          : 'active'
        : 'todo';
  // Publish — the human step; highlighted while the work is ready.
  const publishState = work.status === 'published' ? 'done' : work.status === 'ready' ? 'active' : 'todo';
  return {
    upload: 'done',
    parse: parseState,
    metadata: metadataState,
    audio: audioState,
    publish: publishState,
  };
}

function StepIndicator({ states, activeLabel }: { states: Record<WorkflowStepId, StepState>; activeLabel?: string }) {
  const { locale } = useLocale();

  return (
    <nav
      aria-label={t(locale, 'admin.works.workflowNav.aria')}
      className="mb-8 flex items-center gap-1 overflow-x-auto pb-1"
    >
      {WORKFLOW_STEP_IDS.map((stepId, index) => {
        const state = states[stepId];
        const isDone = state === 'done';
        const isActive = state === 'active';
        const isFailed = state === 'failed';
        return (
          <Fragment key={stepId}>
            {index > 0 ? (
              <div className={cn('h-px w-5 shrink-0 sm:w-7', isDone ? 'bg-brand-deep/50' : 'bg-border')} />
            ) : null}
            <div
              aria-current={isActive ? 'step' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors',
                isActive ? 'bg-brand-soft/60 font-medium text-brand-deep' : 'text-muted-foreground',
                isDone && 'text-foreground',
                isFailed && 'text-destructive',
                state === 'na' && 'opacity-50',
              )}
            >
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  isDone || isActive
                    ? 'bg-brand-deep text-primary-foreground'
                    : isFailed
                      ? 'bg-destructive/15 text-destructive'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                {isDone ? (
                  <Check className="size-3.5" />
                ) : isFailed ? (
                  <TriangleAlert className="size-3.5" />
                ) : (
                  index + 1
                )}
              </span>
              {t(locale, `admin.works.workflowNav.${stepId}`)}
            </div>
          </Fragment>
        );
      })}
      {activeLabel ? <span className="ml-3 text-xs text-muted-foreground">{activeLabel}</span> : null}
    </nav>
  );
}

function EpubDropzone({ onFile, disabled }: { onFile: (file: File) => void; disabled: boolean }) {
  const { locale } = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  function pickFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) {
      onFile(file);
    }
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t(locale, 'admin.works.edit.dropzoneAria')}
      className={cn(
        'group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed bg-card px-6 py-16 text-center transition-colors duration-300 ease-out-soft',
        isDragging ? 'border-brand bg-brand-soft/40' : 'border-border hover:border-brand/60',
        disabled && 'pointer-events-none opacity-60',
      )}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        pickFiles(event.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".epub"
        className="sr-only"
        onChange={(event) => pickFiles(event.target.files)}
      />
      <div className="flex size-12 items-center justify-center rounded-xl bg-brand-soft/60 text-brand-deep transition-transform duration-300 group-hover:-translate-y-0.5">
        <BookOpen className="size-6" />
      </div>
      <p className="font-heading text-base font-medium">{t(locale, 'admin.works.edit.dropzoneTitle')}</p>
      <p className="text-sm text-muted-foreground">{t(locale, 'admin.works.edit.dropzoneHint')}</p>
    </div>
  );
}

type UploadModeProps = {
  onCreated: (created: CreateEpubWorkResult) => void;
};

function UploadMode({ onCreated }: UploadModeProps) {
  const { locale } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [isHashing, setIsHashing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState('');
  const isBusy = isHashing || isUploading;

  async function handleFile(file: File) {
    const validationError = validateEpubFile(file, locale);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setSelectedFileName(file.name);
    setIsHashing(true);
    try {
      const contentHash = await sha256File(file);
      const reuse = await checkEpubWorkReuse({ fileName: file.name, contentHash });
      if (reuse.duplicated) {
        toast.success(t(locale, 'admin.works.edit.instantUploadDone'));
        onCreated(reuse);
        return;
      }

      setIsUploading(true);
      try {
        const result = await uploadAdminEpub(file);
        toast.success(t(locale, 'admin.works.edit.workCreated'));
        onCreated(result);
      } finally {
        setIsUploading(false);
      }
    } catch (uploadError) {
      setError(formatWorksApiError(uploadError));
    } finally {
      setIsHashing(false);
    }
  }

  return (
    <div>
      {isHashing ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <Spinner className="size-6 text-brand" />
          <p className="font-heading text-sm font-medium">
            {t(locale, 'admin.works.edit.hashingFile', { fileName: selectedFileName })}
          </p>
          <p className="text-xs text-muted-foreground">{t(locale, 'admin.works.edit.hashingHint')}</p>
        </div>
      ) : isUploading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <Spinner className="size-6 text-brand" />
          <p className="font-heading text-sm font-medium">
            {t(locale, 'admin.works.edit.uploadingFile', { fileName: selectedFileName })}
          </p>
          <p className="text-xs text-muted-foreground">{t(locale, 'admin.works.edit.uploadingHint')}</p>
        </div>
      ) : (
        <div>
          <EpubDropzone onFile={(file) => void handleFile(file)} disabled={isBusy} />
          {error ? (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <p>{error}</p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

type WorkflowModeProps = {
  workId: string;
  work: AdminWorkView;
};

function WorkEditMode({ workId, work }: WorkflowModeProps) {
  const { locale } = useLocale();
  const router = useRouter();
  const invalidate = useInvalidateAdminWorks();
  const isEpub = work.originKind === 'admin_epub';
  const states = stepStates(work);
  const [actingStep, setActingStep] = useState<WorkflowStep | 'retry' | null>(null);

  // Poll while any pipeline step is running.
  useEffect(() => {
    if (work.status !== 'processing' && work.status !== 'metadata' && work.status !== 'tts') {
      return;
    }
    const timer = window.setInterval(() => {
      void invalidate(workId);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [work.status, workId, invalidate]);

  async function handleRetry(step?: WorkflowStep, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    const isStartingIdle = work.status === 'uploaded' || work.status === 'parsed';
    setActingStep(step ?? 'retry');
    try {
      await retryAdminWorkflow(workId, step);
      await invalidate(workId);
      toast.success(
        isStartingIdle && step
          ? t(locale, 'admin.works.edit.stepStarted', { step: formatWorkflowStep(step, locale) })
          : step
            ? t(locale, 'admin.works.edit.stepRestarted', { step: formatWorkflowStep(step, locale) })
            : t(locale, 'admin.works.edit.retryGeneric'),
      );
    } catch (error) {
      toast.error(formatWorksApiError(error));
    } finally {
      setActingStep(null);
    }
  }

  async function handlePublish() {
    try {
      await publishAdminWork(workId);
      await invalidate(workId);
      toast.success(t(locale, 'admin.content.common.published'));
    } catch (error) {
      toast.error(formatWorksApiError(error));
    }
  }

  async function handleUnpublish() {
    try {
      await unpublishAdminWork(workId);
      await invalidate(workId);
      toast.success(t(locale, 'admin.content.common.unpublished'));
    } catch (error) {
      toast.error(formatWorksApiError(error));
    }
  }

  async function handleDelete() {
    if (!window.confirm(t(locale, 'admin.content.common.confirmDeleteWorkPermanent'))) return;
    try {
      await deleteAdminWork(workId);
      toast.success(t(locale, 'admin.content.common.deleted'));
      router.replace(ADMIN_ROUTES.works);
    } catch (error) {
      toast.error(formatWorksApiError(error));
    }
  }

  const parsed = isEpub ? (work.originMeta.parsed as Record<string, unknown> | undefined) : undefined;
  const publishIssues = work.publishIssues;
  const metadataChecklist = [
    { path: 'title', label: t(locale, 'admin.works.edit.checklistTitleFilled') },
    { path: 'sources', label: t(locale, 'admin.works.edit.checklistSources') },
    { path: 'tags', label: t(locale, 'admin.works.edit.checklistTags') },
    { path: 'body', label: t(locale, 'admin.works.edit.checklistBody') },
  ] as const;
  const audioGateIssues = publishIssues.filter((issue) => issue.path.includes('.audio.'));
  const isRunning = work.status === 'processing' || work.status === 'metadata' || work.status === 'tts';
  const isActing = actingStep !== null;
  const canRerun = isEpub && work.status !== 'published' && !isRunning && !isActing;
  const hasParts = work.parts.length > 0;
  const canPreview = canPreviewWork(work);
  const workflowLabels = workflowModeLabels(work.workflowPolicy, locale);
  const unknownError = t(locale, 'admin.works.edit.unknownError');

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-heading text-3xl font-bold tracking-tight">{t(locale, 'admin.works.edit.title')}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge
              variant={work.status === 'published' ? 'secondary' : work.status === 'failed' ? 'destructive' : 'outline'}
            >
              {formatWorkStatus(
                work.status,
                locale,
                work.status === 'processing' || work.status === 'metadata' || work.status === 'tts'
                  ? 'ellipsis'
                  : 'default',
              )}
            </Badge>
            <Badge variant="outline">{workflowLabels.chain}</Badge>
            <Badge variant="outline">{workflowLabels.audio}</Badge>
            <span className="text-sm text-muted-foreground">{work.title}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canPreview ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={ADMIN_ROUTES.workPreview(work.id)} />}
            >
              {t(locale, 'admin.works.edit.previewWork')}
            </Button>
          ) : hasParts ? (
            <span className="self-center text-sm text-muted-foreground">
              {t(locale, 'admin.works.list.previewUnavailable')}
            </span>
          ) : null}
          {work.status !== 'published' ? (
            <Button type="button" variant="destructive" size="sm" onClick={() => void handleDelete()}>
              {t(locale, 'admin.content.common.delete')}
            </Button>
          ) : null}
        </div>
      </div>

      <StepIndicator states={states} />

      <div className="space-y-6">
        {/* Step 1 — upload */}
        <section className="rounded-2xl border border-border bg-card px-6 py-6">
          <h2 className="flex items-center gap-2 font-heading text-base font-semibold">
            <span className="flex size-6 items-center justify-center rounded-full bg-brand-soft/60 text-brand-deep">
              <BookOpen className="size-3.5" />
            </span>
            {t(locale, 'admin.works.workflowNav.upload')}
            {states.upload === 'done' ? <Check className="size-4 text-brand-deep" /> : null}
          </h2>
          {isEpub ? (
            work.originAsset ? (
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">{t(locale, 'admin.works.edit.fileName')}</dt>
                  <dd className="mt-0.5 truncate font-medium">{work.originAsset.fileName}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t(locale, 'admin.works.edit.fileSize')}</dt>
                  <dd className="mt-0.5 font-medium">{formatFileSize(work.originAsset.size)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t(locale, 'admin.works.edit.fileHash')}</dt>
                  <dd className="mt-0.5 font-mono text-xs">{work.originAsset.contentHash.slice(0, 12)}…</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t(locale, 'admin.works.edit.fileOrigin')}</dt>
                  <dd className="mt-0.5">
                    {work.originAsset.reused ? (
                      <Badge variant="secondary">{t(locale, 'admin.works.edit.originReused')}</Badge>
                    ) : (
                      t(locale, 'admin.works.edit.originUploaded')
                    )}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">{t(locale, 'admin.works.edit.waitingFileInfo')}</p>
            )
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">{t(locale, 'admin.works.edit.textWorkNoSource')}</p>
          )}
        </section>

        {/* Step 2 — parse */}
        <section className="rounded-2xl border border-border bg-card px-6 py-6">
          <h2 className="flex items-center gap-2 font-heading text-base font-semibold">
            <span className="flex size-6 items-center justify-center rounded-full bg-brand-soft/60 text-brand-deep">
              <Sparkles className="size-3.5" />
            </span>
            {t(locale, 'admin.works.workflowNav.parse')}
            {states.parse === 'done' ? <Check className="size-4 text-brand-deep" /> : null}
          </h2>

          {!isEpub ? (
            <p className="mt-4 text-sm text-muted-foreground">{t(locale, 'admin.works.edit.textWorkNoParse')}</p>
          ) : work.status === 'uploaded' ? (
            <div className="mt-4 space-y-4">
              <p className="text-sm text-muted-foreground">{t(locale, 'admin.works.edit.parseReadyHint')}</p>
              <Button type="button" size="sm" onClick={() => void handleRetry('parse')} disabled={!canRerun}>
                {isActing ? t(locale, 'admin.content.common.queuing') : t(locale, 'admin.works.edit.startParse')}
              </Button>
            </div>
          ) : work.status === 'processing' || actingStep === 'parse' ? (
            <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
              <Spinner className="size-4 text-brand" />
              {work.status === 'processing'
                ? t(locale, 'admin.works.edit.parsingChapters')
                : t(locale, 'admin.works.edit.parseTaskSubmitted')}
            </div>
          ) : work.status === 'failed' ? (
            <div className="mt-4 space-y-4">
              <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <p>
                  {work.failedStep && work.failedStep !== 'parse'
                    ? t(locale, 'admin.works.edit.stepFailedPrefix', {
                        step: formatWorkflowStep(work.failedStep, locale),
                      })
                    : ''}
                  {String(work.originMeta.lastError ?? unknownError)}
                </p>
              </div>
              {work.failedStep === 'parse' || !parsed ? (
                <Button type="button" size="sm" onClick={() => void handleRetry()} disabled={isActing}>
                  {isActing ? t(locale, 'admin.content.common.queuing') : t(locale, 'content.common.retry')}
                </Button>
              ) : null}
              {parsed ? (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">{t(locale, 'admin.works.edit.chapterCount')}</dt>
                    <dd className="mt-0.5 font-medium">{String(parsed.chapterCount ?? work.parts.length)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t(locale, 'admin.works.edit.imageCount')}</dt>
                    <dd className="mt-0.5 font-medium">{String(parsed.imageCount ?? 0)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t(locale, 'admin.works.edit.spineCount')}</dt>
                    <dd className="mt-0.5 font-medium">
                      {parsed.spineCount == null
                        ? t(locale, 'admin.content.common.notFilled')
                        : String(parsed.spineCount)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t(locale, 'admin.works.edit.navCount')}</dt>
                    <dd className="mt-0.5 font-medium">
                      {parsed.navCount == null ? t(locale, 'admin.content.common.notFilled') : String(parsed.navCount)}
                    </dd>
                  </div>
                </dl>
              ) : null}
            </div>
          ) : parsed ? (
            <div className="mt-4">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">{t(locale, 'admin.works.edit.chapterCount')}</dt>
                  <dd className="mt-0.5 font-medium">{String(parsed.chapterCount ?? work.parts.length)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t(locale, 'admin.works.edit.imageCount')}</dt>
                  <dd className="mt-0.5 font-medium">{String(parsed.imageCount ?? 0)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t(locale, 'admin.works.edit.spineCount')}</dt>
                  <dd className="mt-0.5 font-medium">
                    {parsed.spineCount == null
                      ? t(locale, 'admin.content.common.notFilled')
                      : String(parsed.spineCount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t(locale, 'admin.works.edit.navCount')}</dt>
                  <dd className="mt-0.5 font-medium">
                    {parsed.navCount == null ? t(locale, 'admin.content.common.notFilled') : String(parsed.navCount)}
                  </dd>
                </div>
              </dl>
              {work.status === 'published' ? (
                <p className="mt-4 text-xs text-muted-foreground">
                  {t(locale, 'admin.works.edit.publishedReparseHint')}
                </p>
              ) : (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleRetry('parse', t(locale, 'admin.works.edit.confirmReparse'))}
                    disabled={!canRerun}
                  >
                    {isActing ? t(locale, 'admin.content.common.queuing') : t(locale, 'admin.works.edit.reparse')}
                  </Button>
                  {canPreview ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={ADMIN_ROUTES.workPreview(work.id)} />}
                    >
                      <ListTree data-icon="inline-start" />
                      {t(locale, 'admin.works.edit.previewWork')}
                    </Button>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {t(locale, 'admin.works.list.previewUnavailable')}
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">{t(locale, 'admin.works.edit.waitingParse')}</p>
          )}
        </section>

        {/* Step 3 — metadata backfill & review */}
        <section className="rounded-2xl border border-border bg-card px-6 py-6">
          <h2 className="flex items-center gap-2 font-heading text-base font-semibold">
            <span className="flex size-6 items-center justify-center rounded-full bg-brand-soft/60 text-brand-deep">
              <Sparkles className="size-3.5" />
            </span>
            {t(locale, 'admin.works.workflowNav.metadata')}
            {states.metadata === 'done' ? <Check className="size-4 text-brand-deep" /> : null}
          </h2>
          <MetadataReviewPanel workId={work.id} work={work} />
        </section>

        {/* Step 4 — audio */}
        <section className="rounded-2xl border border-border bg-card px-6 py-6">
          <h2 className="flex items-center gap-2 font-heading text-base font-semibold">
            <span className="flex size-6 items-center justify-center rounded-full bg-brand-soft/60 text-brand-deep">
              <AudioLines className="size-3.5" />
            </span>
            {t(locale, 'admin.works.workflowNav.audio')}
            {states.audio === 'done' ? <Check className="size-4 text-brand-deep" /> : null}
          </h2>
          {!isEpub ? (
            <p className="mt-4 text-sm text-muted-foreground">{t(locale, 'admin.works.edit.textWorkNoAudio')}</p>
          ) : work.parts.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">{t(locale, 'admin.works.edit.waitingParseForAudio')}</p>
          ) : (
            <>
              <WorkAudioPanel workId={work.id} />
              {audioGateIssues.length > 0 ? (
                <ul className="mt-4 space-y-2 text-sm">
                  {audioGateIssues.map((issue) => (
                    <li key={issue.path} className="flex items-start gap-2 text-destructive">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                      <span>{formatPublishIssue(issue, locale)}</span>
                    </li>
                  ))}
                </ul>
              ) : work.status === 'ready' || work.status === 'published' ? (
                <p className="mt-4 text-sm text-muted-foreground">{t(locale, 'admin.works.edit.audioReadyHint')}</p>
              ) : null}
            </>
          )}
        </section>

        {/* Step 5 — publish */}
        <section className="rounded-2xl border border-border bg-card px-6 py-6">
          <h2 className="flex items-center gap-2 font-heading text-base font-semibold">
            <span className="flex size-6 items-center justify-center rounded-full bg-brand-soft/60 text-brand-deep">
              <Send className="size-3.5" />
            </span>
            {t(locale, 'admin.works.workflowNav.publish')}
            {states.publish === 'done' ? <Check className="size-4 text-brand-deep" /> : null}
          </h2>
          <div className="mt-4">
            <ul className="space-y-2 text-sm">
              {metadataChecklist.map((item) => {
                const isBlocked = publishIssues.some((issue) => issue.path === item.path);
                return (
                  <li key={item.path} className="flex items-center gap-2">
                    {!isBlocked ? (
                      <Check className="size-4 text-brand-deep" />
                    ) : (
                      <TriangleAlert className="size-4 text-destructive" />
                    )}
                    <span className={isBlocked ? 'text-destructive' : ''}>{item.label}</span>
                  </li>
                );
              })}
              {audioGateIssues.length === 0 && work.parts.some((part) => part.body.trim()) ? (
                <li className="flex items-center gap-2">
                  <Check className="size-4 text-brand-deep" />
                  <span>{t(locale, 'admin.works.edit.audioReadyChecklist')}</span>
                </li>
              ) : null}
              {audioGateIssues.map((issue) => (
                <li key={issue.path} className="flex items-start gap-2">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <span className="text-destructive">{formatPublishIssue(issue, locale)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {work.status === 'published' ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => void handleUnpublish()}>
                  {t(locale, 'admin.content.common.unpublish')}
                </Button>
              ) : work.status === 'ready' ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handlePublish()}
                  disabled={publishIssues.length > 0}
                >
                  {t(locale, 'admin.content.common.publish')}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {work.status === 'failed'
                    ? t(locale, 'admin.works.edit.publishBlockedFailed')
                    : t(locale, 'admin.works.edit.publishBlockedIncomplete')}
                </span>
              )}
              {publishIssues.length > 0 && work.status === 'ready' ? (
                <span className="text-xs text-muted-foreground">
                  {t(locale, 'admin.works.edit.publishBlockedIssues')}
                </span>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

type WorksEditPageProps = {
  workId?: string;
};

export function WorksEditPage({ workId }: WorksEditPageProps) {
  const { locale } = useLocale();
  const router = useRouter();
  const detailQuery = useAdminWorkQuery(workId ?? '', { enabled: Boolean(workId) });

  function handleCreated(created: CreateEpubWorkResult) {
    router.replace(ADMIN_ROUTES.workDetail(created.id));
  }

  if (workId && detailQuery.isPending) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-8 h-9 w-64 animate-pulse rounded-2xl bg-surface-container-high" />
        <div className="space-y-6">
          <div className="h-28 animate-pulse rounded-2xl bg-surface-container-high" />
          <div className="h-40 animate-pulse rounded-2xl bg-surface-container-high" />
          <div className="h-40 animate-pulse rounded-2xl bg-surface-container-high" />
        </div>
      </div>
    );
  }

  if (workId && detailQuery.isError && !detailQuery.data) {
    return (
      <div className="mx-auto w-full max-w-4xl rounded-2xl border border-border bg-card px-6 py-14 text-center">
        <FileText className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">
          {t(locale, 'admin.works.edit.loadFailed', { error: formatWorksApiError(detailQuery.error) })}
        </p>
        <Button type="button" variant="outline" className="mt-5" onClick={() => void detailQuery.refetch()}>
          {t(locale, 'content.common.retry')}
        </Button>
      </div>
    );
  }

  const work = workId ? (detailQuery.data ?? null) : null;

  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 mx-auto w-full max-w-4xl">
      <div className="mb-8 flex items-center justify-between gap-4">
        {!work ? (
          <h1 className="font-heading text-3xl font-bold tracking-tight">
            {t(locale, 'admin.works.edit.uploadTitle')}
          </h1>
        ) : null}
        <Button
          nativeButton={false}
          variant="ghost"
          render={<Link href={ADMIN_ROUTES.works}>{t(locale, 'admin.content.common.backToList')}</Link>}
        />
      </div>

      {!work ? (
        <>
          <StepIndicator states={stepStates(null)} />
          <p className="-mt-4 mb-6 text-sm text-muted-foreground">{t(locale, 'admin.works.edit.uploadHint')}</p>
          <div className="rounded-2xl border border-border bg-card px-6 py-8">
            <UploadMode onCreated={handleCreated} />
          </div>
        </>
      ) : (
        <WorkEditMode workId={work.id} work={work} />
      )}
    </div>
  );
}
