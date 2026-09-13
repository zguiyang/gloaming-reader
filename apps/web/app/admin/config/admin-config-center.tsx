'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import { Tabs } from '@/components/ui/tabs';
import { ADMIN_ROUTES } from '@/constants';
import { AdminSegmentedTabsList, AdminSegmentedTabsTrigger } from '@/features/admin/admin-segmented-tabs';
import { AiConfigPage } from '@/features/admin/ai/ai-config-page';
import { DictionaryConfigPage } from '@/features/admin/dictionary/dictionary-config-page';
import { TtsConfigPage } from '@/features/admin/tts/tts-config-page';

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
  const activeTab = parseConfigTab(searchParams.get('tab'));

  function handleTabChange(value: string) {
    const tab = parseConfigTab(value);
    router.replace(ADMIN_ROUTES.configTab(tab), { scroll: false });
  }

  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 mx-auto max-w-6xl">
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <AdminSegmentedTabsList>
          <AdminSegmentedTabsTrigger value="ai">AI</AdminSegmentedTabsTrigger>
          <AdminSegmentedTabsTrigger value="tts">语音</AdminSegmentedTabsTrigger>
          <AdminSegmentedTabsTrigger value="dictionary">词典</AdminSegmentedTabsTrigger>
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
