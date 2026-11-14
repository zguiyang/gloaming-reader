'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { t } from '@/i18n';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthDialog } from '@/features/auth';
import { OwnAiView } from '@/features/settings/llm/own-ai-view';
import { useOwnAiSettings } from '@/features/settings/llm/use-own-ai-settings';
import { formatUserSettingsApiError, getUserTtsConfig, userSettingsQueryKey } from '@/features/settings/settings-api';
import { SettingsTtsSection } from '@/features/settings/tts/settings-tts-section';
import { authClient } from '@/lib/auth';
import { useLocale } from '@/lib/locale-context';

function SettingHeader() {
  const { locale } = useLocale();
  return (
    <header className="mb-6 border-b border-border/40 pb-4">
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
        {t(locale, 'settings.title')}
      </h1>
    </header>
  );
}

function SummaryRow({
  label,
  value,
  description,
  actionLabel,
  onAction,
}: {
  label: string;
  value: string;
  description?: string;
  actionLabel: string;
  onAction: () => void;
}) {
  const { locale } = useLocale();
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/50 py-4">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-sm text-foreground">{t(locale, 'settings.current', { source: value })}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <Button type="button" variant="outline" size="sm" className="h-9 rounded-lg px-4" onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  );
}

export function SettingsPage() {
  const { locale } = useLocale();
  const { openLogin } = useAuthDialog();
  const session = authClient.useSession();
  const ai = useOwnAiSettings({ enabled: Boolean(session.data?.user) });
  const ttsQuery = useQuery({
    queryKey: userSettingsQueryKey.tts(),
    queryFn: ({ signal }) => getUserTtsConfig(signal),
    enabled: Boolean(session.data?.user),
  });
  // Default summary view vs focused own-AI advanced view (accepted board).
  const [view, setView] = useState<'summary' | 'advanced'>('summary');

  useEffect(() => {
    if (!session.isPending && session.error?.status === 401) openLogin();
  }, [openLogin, session.error?.status, session.isPending]);

  if (!session.data?.user && session.isPending) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <SettingHeader />
        <Skeleton className="h-24 rounded bg-surface-container-high" />
      </div>
    );
  }
  if (!session.data?.user) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <SettingHeader />
        <p className="text-sm text-muted-foreground">{t(locale, 'settings.signInRequired')}</p>
      </div>
    );
  }

  const ttsConfig = ttsQuery.data;
  const ttsSourceLabel =
    ttsConfig?.configured && ttsConfig.isEnabled
      ? t(locale, 'settings.tts.ownService')
      : t(locale, 'settings.defaultService');
  const aiSourceLabel = ai.isOwnMode ? t(locale, 'settings.ai.ownService') : t(locale, 'settings.defaultService');

  // Focused advanced view replaces the default body (accepted board), same route.
  if (view === 'advanced') {
    return (
      <OwnAiView
        state={ai}
        onBack={() => {
          ai.closeContext();
          setView('summary');
        }}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl pb-8">
      <SettingHeader />

      {(ai.providersQuery.isPending || ai.settingsQuery.isPending) && (
        <p className="mb-6 text-sm text-muted-foreground">{t(locale, 'settings.loading')}</p>
      )}
      {ai.aiLoadError && (
        <p role="alert" className="mb-6 text-sm text-destructive">
          {formatUserSettingsApiError(ai.aiLoadError)}
        </p>
      )}
      {ttsQuery.error && (
        <p role="alert" className="mb-6 text-sm text-destructive">
          {formatUserSettingsApiError(ttsQuery.error)}
        </p>
      )}

      {/* Reading services: read-only summaries + explicit Change; one editing context at a time */}
      <section className="mb-8">
        <h2 className="font-heading mb-2 text-xl font-semibold">{t(locale, 'settings.readingServices.title')}</h2>
        <SummaryRow
          label={t(locale, 'settings.tts.title')}
          value={ttsSourceLabel}
          description={
            ttsConfig?.configured && ttsConfig.isEnabled
              ? t(locale, 'settings.tts.ownSummary')
              : t(locale, 'settings.tts.defaultSummary')
          }
          actionLabel={t(locale, 'settings.change')}
          onAction={() => ai.openContext('tts')}
        />
        {ai.editingContext === 'tts' && ttsConfig ? (
          <div className="border-b border-border/50 py-4">
            <SettingsTtsSection key={String(ttsConfig.updatedAt)} config={ttsConfig} hideTitle />
            <div className="mt-3">
              <Button type="button" variant="ghost" size="sm" onClick={ai.closeContext}>
                {t(locale, 'settings.cancel')}
              </Button>
            </div>
          </div>
        ) : null}

        <SummaryRow
          label={t(locale, 'settings.ai.service')}
          value={aiSourceLabel}
          description={ai.isOwnMode ? t(locale, 'settings.ai.ownSummary') : t(locale, 'settings.ai.defaultSummary')}
          actionLabel={t(locale, 'settings.change')}
          onAction={() => ai.openContext('ai-mode')}
        />
        {ai.editingContext === 'ai-mode' ? (
          <div className="border-b border-border/50 py-4">
            <div className="flex flex-wrap gap-2" role="group" aria-label={t(locale, 'settings.serviceMode')}>
              <Button
                type="button"
                variant={(ai.aiModeDraft ?? (ai.isOwnMode ? 'own' : 'default')) === 'default' ? 'default' : 'outline'}
                aria-pressed={(ai.aiModeDraft ?? (ai.isOwnMode ? 'own' : 'default')) === 'default'}
                onClick={() => ai.setAiModeDraft('default')}
              >
                {t(locale, 'settings.defaultService')}
              </Button>
              <Button
                type="button"
                variant={(ai.aiModeDraft ?? (ai.isOwnMode ? 'own' : 'default')) === 'own' ? 'default' : 'outline'}
                aria-pressed={(ai.aiModeDraft ?? (ai.isOwnMode ? 'own' : 'default')) === 'own'}
                onClick={() => ai.setAiModeDraft('own')}
              >
                {t(locale, 'settings.ai.ownService')}
              </Button>
            </div>
            {ai.aiModeDraft ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  {t(locale, ai.aiModeDraft === 'default' ? 'settings.ai.confirmDefault' : 'settings.ai.confirmOwn')}
                </p>
                <Button
                  type="button"
                  disabled={ai.modeMutation.isPending || ai.providers.length === 0}
                  onClick={() => ai.modeMutation.mutate(ai.aiModeDraft!)}
                >
                  {t(locale, 'settings.save')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => ai.setAiModeDraft(null)}>
                  {t(locale, 'settings.cancel')}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* Own AI service: entry always reachable, opens the focused advanced view */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="font-heading text-xl font-semibold">{t(locale, 'settings.ownAi.title')}</h2>
            <p className="text-sm text-muted-foreground">{t(locale, 'settings.ownAi.description')}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 rounded-lg px-4"
            onClick={() => setView('advanced')}
          >
            {t(locale, 'settings.ownAi.enter')}
          </Button>
        </div>
      </section>
    </div>
  );
}
