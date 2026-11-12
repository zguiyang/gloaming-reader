'use client';

import { useSearchParams } from 'next/navigation';

import { AiConfigPage } from '@/features/admin/ai/ai-config-page';
import { DictionaryConfigPage } from '@/features/admin/dictionary/dictionary-config-page';
import { TtsConfigPage } from '@/features/admin/tts/tts-config-page';

type ConfigTab = 'ai' | 'tts' | 'dictionary';

function parseConfigTab(raw: string | null): ConfigTab {
  return raw === 'tts' || raw === 'dictionary' ? raw : 'ai';
}

/**
 * Config center renders the active section for the `?tab=` query route.
 * Section navigation lives in the admin sidebar (AdminConfigSubnav).
 */
export function AdminConfigCenter() {
  const searchParams = useSearchParams();
  const activeTab = parseConfigTab(searchParams.get('tab'));

  return (
    <div className="w-full">
      {activeTab === 'ai' ? <AiConfigPage /> : null}
      {activeTab === 'tts' ? <TtsConfigPage /> : null}
      {activeTab === 'dictionary' ? <DictionaryConfigPage /> : null}
    </div>
  );
}
