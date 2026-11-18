import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { ttsConfig as ttsConfigTable } from '@/server/db';
import {
  DEFAULT_TTS_VOICES,
  type PutUserTtsVoicesBody,
  TTS_PROVIDER_AZURE,
  type UserTtsVoicesView,
} from '@/shared/tts';

import type { TtsConfigRow } from '@/server/domains/tts/config/store';
import { db } from '@/server/infra/db';
import { encryptApiKey } from '@/server/infra/llm';

async function loadUserConfigRow(userId: string): Promise<TtsConfigRow | null> {
  const rows = await db.select().from(ttsConfigTable).where(eq(ttsConfigTable.ownerUserId, userId)).limit(1);
  return rows[0] ?? null;
}

function toVoicesView(row: TtsConfigRow | null): UserTtsVoicesView {
  if (!row) {
    return {
      defaultVoice: DEFAULT_TTS_VOICES.defaultVoice,
      usVoice: DEFAULT_TTS_VOICES.usVoice,
      ukVoice: DEFAULT_TTS_VOICES.ukVoice,
      updatedAt: null,
    };
  }
  return {
    defaultVoice: row.defaultVoice,
    usVoice: row.usVoice,
    ukVoice: row.ukVoice,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getUserVoices(userId: string): Promise<UserTtsVoicesView> {
  return toVoicesView(await loadUserConfigRow(userId));
}

/** Persist voice prefs only. Credentials always come from the instance TTS row at synthesis time. */
export async function putUserVoices(userId: string, body: PutUserTtsVoicesBody): Promise<UserTtsVoicesView> {
  const existing = await loadUserConfigRow(userId);
  const voiceValues = {
    defaultVoice: body.defaultVoice,
    usVoice: body.usVoice,
    ukVoice: body.ukVoice,
    isEnabled: false,
  };

  if (existing) {
    const [row] = await db
      .update(ttsConfigTable)
      .set(voiceValues)
      .where(eq(ttsConfigTable.id, existing.id))
      .returning();
    if (row) {
      return toVoicesView(row);
    }
  }

  const [inserted] = await db
    .insert(ttsConfigTable)
    .values({
      id: randomUUID(),
      ownerUserId: userId,
      provider: TTS_PROVIDER_AZURE,
      region: 'unused',
      // Placeholder only — synthesis never uses user-row credentials.
      apiKeyCiphertext: encryptApiKey('user-voice-prefs-only'),
      ...voiceValues,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) {
    return toVoicesView(inserted);
  }

  const winner = await loadUserConfigRow(userId);
  if (!winner) {
    throw new Error(`TTS voice-pref row for user ${userId} disappeared during save`);
  }
  const [row] = await db.update(ttsConfigTable).set(voiceValues).where(eq(ttsConfigTable.id, winner.id)).returning();
  return toVoicesView(row ?? winner);
}

/** Raw user row for voice overlay (may be a legacy BYOK row; only voice fields are read). */
export async function loadUserTtsVoiceRow(userId: string): Promise<TtsConfigRow | null> {
  return loadUserConfigRow(userId);
}
