import { ttsConfig as ttsConfigTable } from '@gloaming/db';
import {
  DEFAULT_TTS_VOICES,
  type PutTtsConfigBody,
  TTS_PROVIDER_AZURE,
  TTS_VOICE_PRESETS,
  type TtsConfigView,
  type TtsVoicePreset,
} from '@gloaming/shared/tts';

import { HTTP_STATUS } from '@/constants';
import { db } from '@/db';
import { AppError } from '@/lib/errors/app-error';
import { ERROR_CODES } from '@/lib/errors/codes';
import { decryptApiKey, encryptApiKey, maskApiKey } from '@/lib/llm';
import { loadConfigRow, TTS_CONFIG_ID, type TtsConfigRow } from '@/modules/tts/config/store';

function emptyConfigView(): TtsConfigView {
  return {
    configured: false,
    provider: TTS_PROVIDER_AZURE,
    region: '',
    isEnabled: false,
    apiKeySet: false,
    apiKeyMasked: null,
    defaultVoice: DEFAULT_TTS_VOICES.defaultVoice,
    usVoice: DEFAULT_TTS_VOICES.usVoice,
    ukVoice: DEFAULT_TTS_VOICES.ukVoice,
    updatedAt: null,
  };
}

function toConfigView(row: TtsConfigRow): TtsConfigView {
  let apiKeyMasked: string | null = null;
  try {
    apiKeyMasked = maskApiKey(decryptApiKey(row.apiKeyCiphertext));
  } catch {
    apiKeyMasked = '****';
  }
  return {
    configured: true,
    provider: TTS_PROVIDER_AZURE,
    region: row.region,
    isEnabled: row.isEnabled,
    apiKeySet: true,
    apiKeyMasked,
    defaultVoice: row.defaultVoice,
    usVoice: row.usVoice,
    ukVoice: row.ukVoice,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function listVoicePresets(): TtsVoicePreset[] {
  return TTS_VOICE_PRESETS.map((preset) => ({ ...preset }));
}

export async function getConfig(): Promise<TtsConfigView> {
  const row = await loadConfigRow();
  return row ? toConfigView(row) : emptyConfigView();
}

export async function putConfig(body: PutTtsConfigBody): Promise<TtsConfigView> {
  const existing = await loadConfigRow();
  if (!existing && !body.apiKey?.trim()) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.TTS.API_KEY_REQUIRED);
  }

  const apiKeyCiphertext = body.apiKey?.trim() ? encryptApiKey(body.apiKey.trim()) : existing!.apiKeyCiphertext;

  const [row] = await db
    .insert(ttsConfigTable)
    .values({
      id: TTS_CONFIG_ID,
      provider: TTS_PROVIDER_AZURE,
      region: body.region,
      apiKeyCiphertext,
      isEnabled: body.isEnabled,
      defaultVoice: body.defaultVoice,
      usVoice: body.usVoice,
      ukVoice: body.ukVoice,
    })
    .onConflictDoUpdate({
      target: ttsConfigTable.id,
      set: {
        region: body.region,
        apiKeyCiphertext,
        isEnabled: body.isEnabled,
        defaultVoice: body.defaultVoice,
        usVoice: body.usVoice,
        ukVoice: body.ukVoice,
      },
    })
    .returning();

  return toConfigView(row!);
}
