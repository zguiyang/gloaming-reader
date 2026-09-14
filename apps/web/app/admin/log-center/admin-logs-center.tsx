'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import { t } from '@gloaming/i18n';

import { Tabs } from '@/components/ui/tabs';
import { ADMIN_ROUTES } from '@/constants';
import { AdminSegmentedTabsList, AdminSegmentedTabsTrigger } from '@/features/admin/admin-segmented-tabs';
import { AiLogsPage } from '@/features/admin/ai/ai-logs-page';
import { TtsLogsPage } from '@/features/admin/tts/tts-logs-page';
import { useLocale } from '@/lib/locale-context';

type LogsTab = 'ai' | 'tts';

function parseLogsTab(raw: string | null): LogsTab {
  if (raw === 'tts') {
    return raw;
  }

  return 'ai';
}

export function AdminLogsCenter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale } = useLocale();
  const activeTab = parseLogsTab(searchParams.get('tab'));

  function handleTabChange(value: string) {
    const tab = parseLogsTab(value);
    router.replace(ADMIN_ROUTES.logsTab(tab), { scroll: false });
  }

  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 mx-auto max-w-6xl">
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <AdminSegmentedTabsList>
          <AdminSegmentedTabsTrigger value="ai">{t(locale, 'admin.logs.centerTabAi')}</AdminSegmentedTabsTrigger>
          <AdminSegmentedTabsTrigger value="tts">{t(locale, 'admin.logs.centerTabTts')}</AdminSegmentedTabsTrigger>
        </AdminSegmentedTabsList>

        <div className="mt-8">
          {activeTab === 'ai' ? <AiLogsPage /> : null}
          {activeTab === 'tts' ? <TtsLogsPage /> : null}
        </div>
      </Tabs>
    </div>
  );
}
