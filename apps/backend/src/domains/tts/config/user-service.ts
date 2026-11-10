import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { ttsConfig as ttsConfigTable } from '@gloaming/db';
import { type PutTtsConfigBody, TTS_PROVIDER_AZURE, type TtsConfigView } from '@gloaming/shared/tts';

import { emptyConfigView, toConfigView } from '@/domains/tts/config/service';
import type { TtsConfigRow } from '@/domains/tts/config/store';
import { db } from '@/infra/db';
import { encryptApiKey } from '@/infra/llm';
import { HTTP_STATUS } from '@/shared/constants';
import { AppError } from '@/shared/errors/app-error';
import { ERROR_CODES } from '@/shared/errors/codes';

async function loadUserConfigRow(userId: string): Promise<TtsConfigRow | null> {
  const rows = await db.select().from(ttsConfigTable).where(eq(ttsConfigTable.ownerUserId, userId)).limit(1);
  return rows[0] ?? null;
}

export async function getUserConfig(userId: string): Promise<TtsConfigView> {
  const row = await loadUserConfigRow(userId);
  return row ? toConfigView(row) : emptyConfigView();
}

export async function putUserConfig(userId: string, body: PutTtsConfigBody): Promise<TtsConfigView> {
  const existing = await loadUserConfigRow(userId);
  if (!existing && !body.apiKey?.trim()) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.TTS.API_KEY_REQUIRED);
  }

  const apiKeyCiphertext = body.apiKey?.trim() ? encryptApiKey(body.apiKey.trim()) : existing!.apiKeyCiphertext;

  if (existing) {
    const [row] = await db
      .update(ttsConfigTable)
      .set({
        region: body.region,
        apiKeyCiphertext,
        isEnabled: body.isEnabled,
        defaultVoice: body.defaultVoice,
        usVoice: body.usVoice,
        ukVoice: body.ukVoice,
      })
      .where(eq(ttsConfigTable.id, existing.id))
      .returning();
    return toConfigView(row!);
  }

  const [row] = await db
    .insert(ttsConfigTable)
    .values({
      id: randomUUID(),
      ownerUserId: userId,
      provider: TTS_PROVIDER_AZURE,
      region: body.region,
      apiKeyCiphertext,
      isEnabled: body.isEnabled,
      defaultVoice: body.defaultVoice,
      usVoice: body.usVoice,
      ukVoice: body.ukVoice,
    })
    .returning();
  return toConfigView(row!);
}
