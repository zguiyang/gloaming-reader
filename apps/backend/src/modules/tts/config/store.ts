import { eq } from 'drizzle-orm';

import { ttsConfig as ttsConfigTable } from '@gloaming/db';

import { db } from '@/db';

export const TTS_CONFIG_ID = 'default';

export type TtsConfigRow = typeof ttsConfigTable.$inferSelect;

export async function loadConfigRow(): Promise<TtsConfigRow | null> {
  const rows = await db.select().from(ttsConfigTable).where(eq(ttsConfigTable.id, TTS_CONFIG_ID)).limit(1);
  return rows[0] ?? null;
}
