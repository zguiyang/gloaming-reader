'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { t } from '@/i18n';

import { Skeleton } from '@/components/ui/skeleton';
import { useAuthDialog } from '@/features/auth';
import { SettingsPurposeModels } from '@/features/settings/llm/settings-purpose-models';
import { formatUserSettingsApiError, getUserTtsVoices, userSettingsQueryKey } from '@/features/settings/settings-api';
import { SettingsTtsVoices } from '@/features/settings/tts/settings-tts-voices';
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

export function SettingsPage() {
  const { locale } = useLocale();
  const { openLogin } = useAuthDialog();
  const session = authClient.useSession();
  const signedIn = Boolean(session.data?.user);
  const ttsQuery = useQuery({
    queryKey: userSettingsQueryKey.tts(),
    queryFn: ({ signal }) => getUserTtsVoices(signal),
    enabled: signedIn,
  });

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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 pb-8">
      <SettingHeader />

      {ttsQuery.error ? (
        <p role="alert" className="text-sm text-destructive">
          {formatUserSettingsApiError(ttsQuery.error)}
        </p>
      ) : null}
      {ttsQuery.isPending ? (
        <Skeleton className="h-40 rounded bg-surface-container-high" />
      ) : ttsQuery.data ? (
        <SettingsTtsVoices key={String(ttsQuery.data.updatedAt)} voices={ttsQuery.data} />
      ) : null}

      <SettingsPurposeModels enabled={signedIn} />
    </div>
  );
}
