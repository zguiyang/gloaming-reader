import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { ttsConfig as ttsConfigTable } from '@/server/db';
import { type PutTtsConfigBody, TTS_PROVIDER_AZURE, type TtsConfigView } from '@/shared/tts';

import { emptyConfigView, toConfigView } from '@/server/domains/tts/config/service';
import type { TtsConfigRow } from '@/server/domains/tts/config/store';
import { db } from '@/server/infra/db';
import { encryptApiKey } from '@/server/infra/llm';
import { HTTP_STATUS } from '@/server/shared/constants';
import { AppError } from '@/server/shared/errors/app-error';
import { ERROR_CODES } from '@/server/shared/errors/codes';

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
  const values = {
    region: body.region,
    apiKeyCiphertext,
    isEnabled: body.isEnabled,
    defaultVoice: body.defaultVoice,
    usVoice: body.usVoice,
    ukVoice: body.ukVoice,
  };

  if (existing) {
    const [row] = await db.update(ttsConfigTable).set(values).where(eq(ttsConfigTable.id, existing.id)).returning();
    if (row) {
      return toConfigView(row);
    }
    // Deleted between the read and the update; fall through and re-create.
  }

  const [inserted] = await db
    .insert(ttsConfigTable)
    .values({
      id: randomUUID(),
      ownerUserId: userId,
      provider: TTS_PROVIDER_AZURE,
      ...values,
    })
    // `tts_config_user_uidx` makes a concurrent first save collide; without this
    // the unique violation escaped as an unhandled 500.
    .onConflictDoNothing()
    .returning();
  if (inserted) {
    return toConfigView(inserted);
  }

  const winner = await loadUserConfigRow(userId);
  if (!winner) {
    throw new Error(`TTS config row for user ${userId} disappeared during save`);
  }
  const [row] = await db.update(ttsConfigTable).set(values).where(eq(ttsConfigTable.id, winner.id)).returning();
  return toConfigView(row ?? winner);
}
