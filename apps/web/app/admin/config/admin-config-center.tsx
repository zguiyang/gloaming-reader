'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import { t } from '@gloaming/i18n';

import { Tabs } from '@/components/ui/tabs';
import { ADMIN_ROUTES } from '@/constants';
import { AdminSegmentedTabsList, AdminSegmentedTabsTrigger } from '@/features/admin/admin-segmented-tabs';
import { AiConfigPage } from '@/features/admin/ai/ai-config-page';
import { DictionaryConfigPage } from '@/features/admin/dictionary/dictionary-config-page';
import { TtsConfigPage } from '@/features/admin/tts/tts-config-page';
import { useLocale } from '@/lib/locale-context';

type ConfigTab = 'ai' | 'tts' | 'dictionary';

function parseConfigTab(raw: string | null): ConfigTab {
  if (raw === 'tts' || raw === 'dictionary') {
    return raw;
  }

  return 'ai';
}

export function AdminConfigCenter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale } = useLocale();
  const activeTab = parseConfigTab(searchParams.get('tab'));

  function handleTabChange(value: string) {
    const tab = parseConfigTab(value);
    router.replace(ADMIN_ROUTES.configTab(tab), { scroll: false });
  }

  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 mx-auto max-w-6xl">
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <AdminSegmentedTabsList>
          <AdminSegmentedTabsTrigger value="ai">{t(locale, 'admin.config.tabAi')}</AdminSegmentedTabsTrigger>
          <AdminSegmentedTabsTrigger value="tts">{t(locale, 'admin.config.tabTts')}</AdminSegmentedTabsTrigger>
          <AdminSegmentedTabsTrigger value="dictionary">
            {t(locale, 'admin.config.tabDictionary')}
          </AdminSegmentedTabsTrigger>
        </AdminSegmentedTabsList>

        <div className="mt-8">
          {activeTab === 'ai' ? <AiConfigPage /> : null}
          {activeTab === 'tts' ? <TtsConfigPage /> : null}
          {activeTab === 'dictionary' ? <DictionaryConfigPage /> : null}
        </div>
      </Tabs>
    </div>
  );
}
