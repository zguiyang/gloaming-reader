import { type Locale, t } from '@gloaming/i18n';
import type { ContentAssetTrack } from '@gloaming/shared/content-assets';
import type { WorkflowStep, WorkMetadataProvenance, WorkProcessingStatus } from '@gloaming/shared/works';

import { isTtsWorkflowActive, isWorkPublished } from '@/features/admin/works/works-model';

const WORK_PROCESSING_STATUS_KEYS: Record<WorkProcessingStatus, string> = {
  uploaded: 'uploaded',
  processing: 'processing',
  parsed: 'parsed',
  metadata: 'metadata',
  ready: 'ready',
  failed: 'failed',
};

const WORKFLOW_STEP_KEYS: Record<WorkflowStep, string> = {
  parse: 'parse',
  metadata: 'metadata',
  tts: 'tts',
};

const PROVENANCE_KEYS: Record<WorkMetadataProvenance, string> = {
  extracted: 'extracted',
  ai: 'ai',
  manual: 'manual',
};

const AUDIO_TRACK_STATUS_KEYS: Record<ContentAssetTrack['status'], string> = {
  none: 'none',
  generating: 'generating',
  ready: 'ready',
  stale: 'stale',
  failed: 'failed',
};

export function formatWorkProcessingStatus(
  status: WorkProcessingStatus,
  locale: Locale,
  variant: 'default' | 'ellipsis' = 'default',
): string {
  const key = WORK_PROCESSING_STATUS_KEYS[status];
  const suffix = variant === 'ellipsis' && (status === 'processing' || status === 'metadata') ? 'Ellipsis' : '';
  return t(locale, `admin.works.status.${key}${suffix}`);
}

export function formatAdminWorkStatus(
  work: {
    processingStatus: WorkProcessingStatus;
    publishedAt: string | null;
    originMeta: Record<string, unknown>;
  },
  locale: Locale,
  variant: 'default' | 'ellipsis' = 'default',
): string {
  if (isWorkPublished(work)) {
    return t(locale, 'admin.works.status.published');
  }
  if (isTtsWorkflowActive(work)) {
    const suffix = variant === 'ellipsis' ? 'Ellipsis' : '';
    return t(locale, `admin.works.status.tts${suffix}`);
  }
  return formatWorkProcessingStatus(work.processingStatus, locale, variant);
}

export function formatWorkflowStep(step: WorkflowStep, locale: Locale): string {
  return t(locale, `admin.works.workflowStep.${WORKFLOW_STEP_KEYS[step]}`);
}

export function formatProvenance(provenance: WorkMetadataProvenance, locale: Locale): string {
  return t(locale, `admin.content.provenance.${PROVENANCE_KEYS[provenance]}`);
}

export function workflowModeLabels(
  policy: { autoChainEnabled: boolean; ttsStepEnabled: boolean },
  locale: Locale,
): { chain: string; audio: string } {
  return {
    chain: policy.autoChainEnabled
      ? t(locale, 'admin.works.workflowMode.chainAuto')
      : t(locale, 'admin.works.workflowMode.chainManual'),
    audio: policy.ttsStepEnabled
      ? t(locale, 'admin.works.workflowMode.audioAuto')
      : t(locale, 'admin.works.workflowMode.audioManual'),
  };
}

export function formatWorkUpdatedAt(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatAudioTrackStatus(status: ContentAssetTrack['status'], locale: Locale): string {
  return t(locale, `admin.works.audioTrackStatus.${AUDIO_TRACK_STATUS_KEYS[status]}`);
}
